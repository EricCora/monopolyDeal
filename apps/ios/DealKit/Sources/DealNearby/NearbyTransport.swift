import Foundation

/// A phone linked to the host, named by the transport. It changes when the phone reconnects;
/// the seat token, not this, says who it is.
public struct NearbyPeer: Hashable, Sendable {
    public var id: String
    public init(id: String) { self.id = id }
}

/// A table someone close by is hosting.
public struct NearbyTableAd: Hashable, Sendable, Identifiable {
    public var tableId: String
    public var hostName: String
    /// The transport's handle for reaching the host.
    public var peer: NearbyPeer
    public var id: String { tableId }

    public init(tableId: String, hostName: String, peer: NearbyPeer) {
        self.tableId = tableId
        self.hostName = hostName
        self.peer = peer
    }
}

public enum NearbyLinkState: Equatable, Sendable {
    case idle, connecting, connected, disconnected
}

/// How the host reaches the phones at its table. Multipeer in the app, a pair of queues in tests.
@MainActor
public protocol NearbyHostTransport: AnyObject {
    var onConnect: ((NearbyPeer) -> Void)? { get set }
    var onDisconnect: ((NearbyPeer) -> Void)? { get set }
    var onReceive: ((NearbyPeer, Data) -> Void)? { get set }
    /// Starts showing the table to phones close by.
    func start(tableId: String, hostName: String)
    func stop()
    func send(_ data: Data, to peer: NearbyPeer)
    func disconnect(_ peer: NearbyPeer)
}

/// How a joining phone finds tables and talks to one host.
@MainActor
public protocol NearbyGuestTransport: AnyObject {
    var onTablesChange: (([NearbyTableAd]) -> Void)? { get set }
    var onLinkChange: ((NearbyLinkState) -> Void)? { get set }
    var onReceive: ((Data) -> Void)? { get set }
    func startBrowsing()
    func stop()
    func connect(to table: NearbyTableAd)
    func send(_ data: Data)
}
