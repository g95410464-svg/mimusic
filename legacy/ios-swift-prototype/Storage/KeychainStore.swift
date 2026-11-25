import Foundation
import Security

protocol CredentialsStore: Sendable {
    func loadConfiguration() throws -> ServerConfiguration?
    func loadCredentials() throws -> ServerCredentials
    func save(configuration: ServerConfiguration, password: String?) throws
    func delete() throws
}

struct KeychainStore: CredentialsStore {
    private let service: String
    private let account = "navidrome"

    init(service: String = (Bundle.main.bundleIdentifier ?? "MiMusica") + ".credentials") {
        self.service = service
    }

    // URL y usuario son atributos del mismo elemento; leerlos no recupera
    // kSecValueData, que contiene exclusivamente la contraseña.
    func loadConfiguration() throws -> ServerConfiguration? {
        guard let item = try read(includePassword: false) else { return nil }
        return try configuration(from: item)
    }

    // Solo el constructor de peticiones llama a este método en producción.
    func loadCredentials() throws -> ServerCredentials {
        guard let item = try read(includePassword: true) else {
            throw SubsonicError.missingCredentials
        }
        guard let data = item[kSecValueData as String] as? Data,
              let password = String(data: data, encoding: .utf8), !password.isEmpty else {
            throw KeychainError.invalidData
        }
        return ServerCredentials(configuration: try configuration(from: item), password: password)
    }

    func save(configuration: ServerConfiguration, password: String?) throws {
        if let password, password.isEmpty { throw SubsonicError.missingPassword }
        if password == nil, try loadConfiguration() != configuration {
            throw SubsonicError.missingPassword
        }
        var attributes: [String: Any] = [
            kSecAttrGeneric as String: try JSONEncoder().encode(configuration),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        ]
        if let password { attributes[kSecValueData as String] = Data(password.utf8) }

        let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes as CFDictionary)
        if updateStatus == errSecItemNotFound {
            guard password != nil else { throw SubsonicError.missingPassword }
            var item = baseQuery
            item.merge(attributes) { _, new in new }
            let addStatus = SecItemAdd(item as CFDictionary, nil)
            guard addStatus == errSecSuccess else { throw KeychainError.status(addStatus) }
        } else if updateStatus != errSecSuccess {
            throw KeychainError.status(updateStatus)
        }
    }

    func delete() throws {
        let status = SecItemDelete(baseQuery as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw KeychainError.status(status)
        }
    }

    private var baseQuery: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrSynchronizable as String: false
        ]
    }

    private func read(includePassword: Bool) throws -> [String: Any]? {
        var query = baseQuery
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        query[kSecReturnAttributes as String] = true
        query[kSecReturnData as String] = includePassword
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess else { throw KeychainError.status(status) }
        guard let item = result as? [String: Any] else { throw KeychainError.invalidData }
        return item
    }

    private func configuration(from item: [String: Any]) throws -> ServerConfiguration {
        guard let data = item[kSecAttrGeneric as String] as? Data else {
            throw KeychainError.invalidData
        }
        let saved = try JSONDecoder().decode(ServerConfiguration.self, from: data)
        return try ServerConfiguration(serverAddress: saved.serverURL.absoluteString, username: saved.username)
    }
}

enum KeychainError: Error {
    case status(OSStatus)
    case invalidData
}
