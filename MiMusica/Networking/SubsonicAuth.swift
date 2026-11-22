import CryptoKit
import Foundation

enum SubsonicAuth {
    static func token(password: String, salt: String) -> String {
        Insecure.MD5.hash(data: Data((password + salt).utf8))
            .map { String(format: "%02x", $0) }.joined()
    }

    static func makeSalt() -> String {
        var generator = SystemRandomNumberGenerator()
        return (0..<16).map { _ in
            String(format: "%02x", UInt8.random(in: .min ... .max, using: &generator))
        }.joined()
    }

    static func queryItems(username: String, password: String) -> [URLQueryItem] {
        let salt = makeSalt()
        return [
            URLQueryItem(name: "u", value: username),
            URLQueryItem(name: "t", value: token(password: password, salt: salt)),
            URLQueryItem(name: "s", value: salt),
            URLQueryItem(name: "v", value: "1.16.1"),
            URLQueryItem(name: "c", value: "mimusic"),
            URLQueryItem(name: "f", value: "json")
        ]
    }
}
