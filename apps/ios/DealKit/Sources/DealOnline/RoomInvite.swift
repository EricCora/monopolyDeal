import Foundation

/// The links a room invite is made of. Browsers open the web link, and the app opens
/// its own. Web and app players can share a room either way.
public enum RoomInvite {
    public static let webURL = URL(string: "https://monopoly-deal-smoky.vercel.app")!

    /// The room code in a `monopolydeal://join/CODE` or `https://…/join/CODE` link, in the
    /// form the server uses. Nil when the link isn't an invite.
    public static func roomCode(from url: URL) -> String? {
        var parts = url.pathComponents.filter { $0 != "/" }
        if url.scheme == "monopolydeal", let host = url.host() { parts.insert(host, at: 0) }
        guard let index = parts.firstIndex(where: { $0.lowercased() == "join" }), index + 1 < parts.count else { return nil }
        let code = parts[index + 1].uppercased().filter { $0.isLetter || $0.isNumber }
        return (4...8).contains(code.count) ? code : nil
    }

    public static func text(roomCode: String) -> String {
        """
        Join my Monopoly Deal room. The code is \(roomCode).
        In a browser: \(webURL.appendingPathComponent("join").appendingPathComponent(roomCode).absoluteString)
        In the iPhone app: monopolydeal://join/\(roomCode)
        """
    }
}
