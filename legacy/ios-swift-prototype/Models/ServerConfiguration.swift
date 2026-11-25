import Foundation

struct ServerConfiguration: Codable, Equatable, Sendable {
    let serverURL: URL
    let username: String

    init(serverAddress: String, username: String) throws {
        let address = serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)
        let user = username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !address.isEmpty,
              address.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
              var components = URLComponents(string: address),
              let scheme = components.scheme?.lowercased(),
              ["https", "http"].contains(scheme),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil,
              components.port.map({ (1...65535).contains($0) }) ?? true else {
            throw SubsonicError.invalidURL
        }
        guard !user.isEmpty else { throw SubsonicError.missingUsername }
        components.scheme = scheme
        components.host = host.lowercased()
        while components.percentEncodedPath.hasSuffix("/") {
            components.percentEncodedPath.removeLast()
        }
        guard let url = components.url else { throw SubsonicError.invalidURL }
        serverURL = url
        self.username = user
    }
}

struct ServerCredentials: Sendable {
    let configuration: ServerConfiguration
    let password: String
}
