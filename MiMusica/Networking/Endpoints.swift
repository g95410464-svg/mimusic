import Foundation

enum Endpoint: Sendable {
    case ping

    var path: String {
        switch self {
        case .ping: return "ping"
        }
    }
}
