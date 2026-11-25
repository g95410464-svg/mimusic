import Foundation

struct PingResponse: Decodable, Sendable {
    let version: String
}

struct SubsonicResponse<Payload: Decodable>: Decodable {
    let payload: Payload

    private enum RootKeys: String, CodingKey {
        case response = "subsonic-response"
    }

    private enum ResponseKeys: String, CodingKey {
        case status, error
    }

    private enum Status: String, Decodable {
        case ok, failed
    }

    private struct ServerFailure: Decodable {
        let code: Int
        let message: String?
    }

    init(from decoder: Decoder) throws {
        let root = try decoder.container(keyedBy: RootKeys.self)
        let responseDecoder = try root.superDecoder(forKey: .response)
        let response = try responseDecoder.container(keyedBy: ResponseKeys.self)
        switch try response.decode(Status.self, forKey: .status) {
        case .ok:
            payload = try Payload(from: responseDecoder)
        case .failed:
            let failure = try response.decode(ServerFailure.self, forKey: .error)
            if failure.code == 40 { throw SubsonicError.unauthorized }
            throw SubsonicError.server(
                code: failure.code,
                message: failure.message ?? "El servidor rechazó la petición."
            )
        }
    }
}
