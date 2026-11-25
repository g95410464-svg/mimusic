import Foundation

protocol ConnectionChecking: Sendable {
    func ping() async throws -> PingResponse
}

final class SubsonicClient: ConnectionChecking, Sendable {
    private let credentialsStore: any CredentialsStore
    private let session: URLSession

    init(credentialsStore: any CredentialsStore, session: URLSession? = nil) {
        self.credentialsStore = credentialsStore
        self.session = session ?? Self.makeSession()
    }

    func ping() async throws -> PingResponse {
        try await request(.ping)
    }

    func request<T: Decodable>(_ endpoint: Endpoint) async throws -> T {
        try Task.checkCancellation()
        var request = URLRequest(url: try makeURL(for: endpoint))
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request, delegate: RejectRedirects())
        } catch {
            if Task.isCancelled || (error as? URLError)?.code == .cancelled {
                throw CancellationError()
            }
            throw SubsonicError.network(error)
        }
        try Task.checkCancellation()
        guard let httpResponse = response as? HTTPURLResponse else {
            throw SubsonicError.invalidResponse
        }
        if httpResponse.statusCode == 401 { throw SubsonicError.unauthorized }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw SubsonicError.httpStatus(httpResponse.statusCode)
        }
        do {
            return try JSONDecoder().decode(SubsonicResponse<T>.self, from: data).payload
        } catch let error as SubsonicError {
            throw error
        } catch {
            throw SubsonicError.decoding(error)
        }
    }

    // Síncrono para compartir este constructor con las URLs de audio y portadas
    // cuando se implementen sus fases. No conserva contraseñas en el cliente.
    func makeURL(for endpoint: Endpoint) throws -> URL {
        let credentials: ServerCredentials
        do {
            credentials = try credentialsStore.loadCredentials()
        } catch let error as SubsonicError {
            throw error
        } catch {
            throw SubsonicError.credentialStorage(error)
        }
        let configuration = try ServerConfiguration(
            serverAddress: credentials.configuration.serverURL.absoluteString,
            username: credentials.configuration.username
        )
        let baseURL = configuration.serverURL.appendingPathComponent("rest")
            .appendingPathComponent(endpoint.path)
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw SubsonicError.invalidURL
        }
        components.queryItems = SubsonicAuth.queryItems(
            username: configuration.username, password: credentials.password
        )
        // Algunos servidores interpretan '+' como espacio en la query.
        components.percentEncodedQuery = components.percentEncodedQuery?
            .replacingOccurrences(of: "+", with: "%2B")
        guard let url = components.url else { throw SubsonicError.invalidURL }
        return url
    }

    private static func makeSession() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 15
        configuration.waitsForConnectivity = false
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCredentialStorage = nil
        return URLSession(configuration: configuration)
    }
}

private final class RejectRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // Evita reenviar parámetros de autenticación a otra URL o degradar HTTPS.
        completionHandler(nil)
    }
}
