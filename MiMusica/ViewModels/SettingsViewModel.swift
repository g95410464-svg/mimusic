import Foundation
import Observation

@MainActor
@Observable
final class SettingsViewModel {
    enum ConnectionState: Equatable {
        case idle
        case testing
        case connected
        case failed(String)
    }

    var serverAddress = "" { didSet { resetStatus() } }
    var username = "" { didSet { resetStatus() } }
    var password = "" { didSet { resetStatus() } }
    private(set) var state: ConnectionState = .idle
    private(set) var isTesting = false
    private(set) var hasSavedCredentials = false

    @ObservationIgnored private let store: any CredentialsStore
    @ObservationIgnored private let client: any ConnectionChecking
    @ObservationIgnored private var didLoad = false

    init(store: any CredentialsStore, client: any ConnectionChecking) {
        self.store = store
        self.client = client
    }

    var canTest: Bool {
        !isTesting && !serverAddress.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !username.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && (!password.isEmpty || hasSavedCredentials)
    }

    var usesHTTP: Bool {
        serverAddress.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased().hasPrefix("http://")
    }

    func load() {
        guard !didLoad else { return }
        do {
            if let configuration = try store.loadConfiguration() {
                serverAddress = configuration.serverURL.absoluteString
                username = configuration.username
                hasSavedCredentials = true
            }
            didLoad = true
        } catch {
            state = .failed(message(for: SubsonicError.credentialStorage(error)))
        }
    }

    func testConnection() async {
        guard !isTesting else { return }
        isTesting = true
        defer { isTesting = false }
        do {
            try Task.checkCancellation()
            let configuration = try ServerConfiguration(serverAddress: serverAddress, username: username)
            do {
                try store.save(configuration: configuration, password: password.isEmpty ? nil : password)
            } catch let error as SubsonicError {
                throw error
            } catch {
                throw SubsonicError.credentialStorage(error)
            }
            hasSavedCredentials = true
            password = ""
            serverAddress = configuration.serverURL.absoluteString
            username = configuration.username
            state = .testing
            _ = try await client.ping()
            try Task.checkCancellation()
            state = .connected
        } catch is CancellationError {
            state = .idle
        } catch {
            state = .failed(message(for: error))
        }
    }

    func forgetCredentials() {
        guard !isTesting else { return }
        do {
            try store.delete()
            serverAddress = ""
            username = ""
            password = ""
            hasSavedCredentials = false
            state = .idle
        } catch {
            state = .failed(message(for: SubsonicError.credentialStorage(error)))
        }
    }

    private func resetStatus() {
        if !isTesting { state = .idle }
    }

    private func message(for error: Error) -> String {
        // Nunca usa localizedDescription de errores de URLSession, que puede
        // contener la URL autenticada dentro de su información de diagnóstico.
        (error as? SubsonicError)?.errorDescription ?? "No se pudo completar la operación. Inténtalo de nuevo."
    }
}
