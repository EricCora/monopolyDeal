import Foundation
@preconcurrency import MultipeerConnectivity

/// Multipeer Connectivity finds phones close by over Bluetooth and peer-to-peer Wi-Fi, with
/// no router or internet, and encrypts the link. Its callbacks arrive on its own queue, so
/// each one hops to the main actor before touching anything.
private struct Unchecked<Value>: @unchecked Sendable {
    let value: Value
}

private func peerName(_ name: String) -> String {
    // A peer's display name is limited to 63 bytes of UTF-8.
    var trimmed = String(name.prefix(Nearby.maxNameLength))
    while trimmed.utf8.count > 63 { trimmed.removeLast() }
    return trimmed.isEmpty ? "Player" : trimmed
}

@MainActor
public final class MultipeerHostTransport: NSObject, NearbyHostTransport {
    public var onConnect: ((NearbyPeer) -> Void)?
    public var onDisconnect: ((NearbyPeer) -> Void)?
    public var onReceive: ((NearbyPeer, Data) -> Void)?

    private var session: MCSession?
    private var advertiser: MCNearbyServiceAdvertiser?
    private var peers: [MCPeerID: NearbyPeer] = [:]

    override public init() {}

    public func start(tableId: String, hostName: String) {
        stop()
        let me = MCPeerID(displayName: peerName(hostName))
        let session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self
        let info = ["table": tableId, "host": String(hostName.prefix(Nearby.maxNameLength)), "v": "\(Nearby.protocolVersion)"]
        let advertiser = MCNearbyServiceAdvertiser(peer: me, discoveryInfo: info, serviceType: Nearby.serviceType)
        advertiser.delegate = self
        self.session = session
        self.advertiser = advertiser
        advertiser.startAdvertisingPeer()
    }

    public func stop() {
        advertiser?.stopAdvertisingPeer()
        advertiser?.delegate = nil
        advertiser = nil
        session?.delegate = nil
        session?.disconnect()
        session = nil
        let dropped = Array(peers.values)
        peers = [:]
        for peer in dropped { onDisconnect?(peer) }
    }

    public func send(_ data: Data, to peer: NearbyPeer) {
        guard let session, let id = peers.first(where: { $0.value == peer })?.key else { return }
        try? session.send(data, toPeers: [id], with: .reliable)
    }

    /// A session can't drop one peer, so this stops talking to it. Its phone closes the link itself.
    public func disconnect(_ peer: NearbyPeer) {
        if let id = peers.first(where: { $0.value == peer })?.key { peers[id] = nil }
    }

    fileprivate func changed(_ id: MCPeerID, _ state: MCSessionState, in changedSession: MCSession) {
        guard changedSession === session else { return }
        switch state {
        case .connected:
            guard peers[id] == nil else { return }
            let peer = NearbyPeer(id: UUID().uuidString)
            peers[id] = peer
            onConnect?(peer)
        case .notConnected:
            if let peer = peers.removeValue(forKey: id) { onDisconnect?(peer) }
        default:
            break
        }
    }

    fileprivate func received(_ data: Data, from id: MCPeerID, in fromSession: MCSession) {
        guard fromSession === session, let peer = peers[id] else { return }
        onReceive?(peer, data)
    }

    fileprivate func invited(_ accept: @escaping (Bool, MCSession?) -> Void) {
        // Anyone close by may sit down. The table itself refuses a full table or a game already under way.
        accept(session != nil, session)
    }
}

extension MultipeerHostTransport: MCSessionDelegate, MCNearbyServiceAdvertiserDelegate {
    nonisolated public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let box = Unchecked(value: (session, peerID))
        Task { @MainActor in self.changed(box.value.1, state, in: box.value.0) }
    }

    nonisolated public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        let box = Unchecked(value: (session, peerID))
        Task { @MainActor in self.received(data, from: box.value.1, in: box.value.0) }
    }

    nonisolated public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    nonisolated public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}

    nonisolated public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        let box = Unchecked(value: invitationHandler)
        Task { @MainActor in self.invited(box.value) }
    }
}

@MainActor
public final class MultipeerGuestTransport: NSObject, NearbyGuestTransport {
    public var onTablesChange: (([NearbyTableAd]) -> Void)?
    public var onLinkChange: ((NearbyLinkState) -> Void)?
    public var onReceive: ((Data) -> Void)?

    private let displayName: String
    private var me: MCPeerID?
    private var browser: MCNearbyServiceBrowser?
    private var session: MCSession?
    private var target: MCPeerID?
    /// Each host found, with when it was found: a host that restarted shows up again under a new peer.
    private var found: [MCPeerID: (ad: NearbyTableAd, order: Int)] = [:]
    private var foundCount = 0

    public init(displayName: String) {
        self.displayName = peerName(displayName)
    }

    public func startBrowsing() {
        guard browser == nil else { return }
        let me = MCPeerID(displayName: displayName)
        let browser = MCNearbyServiceBrowser(peer: me, serviceType: Nearby.serviceType)
        browser.delegate = self
        self.me = me
        self.browser = browser
        browser.startBrowsingForPeers()
    }

    public func stop() {
        browser?.stopBrowsingForPeers()
        browser?.delegate = nil
        browser = nil
        closeSession()
        found = [:]
        publish()
    }

    public func connect(to table: NearbyTableAd) {
        guard let me, let browser, let id = found.first(where: { $0.value.ad.peer == table.peer })?.key else {
            onLinkChange?(.disconnected)
            return
        }
        closeSession()
        let session = MCSession(peer: me, securityIdentity: nil, encryptionPreference: .required)
        session.delegate = self
        self.session = session
        target = id
        onLinkChange?(.connecting)
        browser.invitePeer(id, to: session, withContext: nil, timeout: 15)
    }

    public func send(_ data: Data) {
        guard let session, let target, session.connectedPeers.contains(target) else { return }
        try? session.send(data, toPeers: [target], with: .reliable)
    }

    private func closeSession() {
        session?.delegate = nil
        session?.disconnect()
        session = nil
        target = nil
    }

    /// One entry per table, the most recently found host winning.
    private func publish() {
        var latest: [String: (ad: NearbyTableAd, order: Int)] = [:]
        for entry in found.values where (latest[entry.ad.tableId]?.order ?? -1) < entry.order {
            latest[entry.ad.tableId] = entry
        }
        onTablesChange?(latest.values.sorted { $0.order < $1.order }.map(\.ad))
    }

    fileprivate func foundPeer(_ id: MCPeerID, info: [String: String]?) {
        guard let info, let tableId = info["table"], let host = info["host"], info["v"] == "\(Nearby.protocolVersion)" else { return }
        foundCount += 1
        found[id] = (NearbyTableAd(tableId: tableId, hostName: host, peer: NearbyPeer(id: UUID().uuidString)), foundCount)
        publish()
    }

    fileprivate func lostPeer(_ id: MCPeerID) {
        guard found.removeValue(forKey: id) != nil else { return }
        publish()
    }

    fileprivate func changed(_ id: MCPeerID, _ state: MCSessionState, in changedSession: MCSession) {
        guard changedSession === session, id == target else { return }
        switch state {
        case .connected: onLinkChange?(.connected)
        case .connecting: onLinkChange?(.connecting)
        case .notConnected:
            closeSession()
            onLinkChange?(.disconnected)
        @unknown default: break
        }
    }

    fileprivate func received(_ data: Data, from id: MCPeerID, in fromSession: MCSession) {
        guard fromSession === session, id == target else { return }
        onReceive?(data)
    }
}

extension MultipeerGuestTransport: MCSessionDelegate, MCNearbyServiceBrowserDelegate {
    nonisolated public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let box = Unchecked(value: (session, peerID))
        Task { @MainActor in self.changed(box.value.1, state, in: box.value.0) }
    }

    nonisolated public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        let box = Unchecked(value: (session, peerID))
        Task { @MainActor in self.received(data, from: box.value.1, in: box.value.0) }
    }

    nonisolated public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    nonisolated public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    nonisolated public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}

    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        let box = Unchecked(value: peerID)
        Task { @MainActor in self.foundPeer(box.value, info: info) }
    }

    nonisolated public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        let box = Unchecked(value: peerID)
        Task { @MainActor in self.lostPeer(box.value) }
    }
}
