import Foundation

enum SubsonicError: Error, LocalizedError {
    case invalidURL
    case missingUsername
    case missingPassword
    case missingCredentials
    case unauthorized
    case server(code: Int, message: String)
    case httpStatus(Int)
    case invalidResponse
    case network(Error)
    case decoding(Error)
    case credentialStorage(Error)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Escribe la URL base completa (https://servidor), sin usuario, contraseña, parámetros ni /rest/ping."
        case .missingUsername:
            return "Escribe tu usuario de Navidrome."
        case .missingPassword:
            return "Escribe la contraseña. Si cambias el servidor o el usuario, debes introducirla de nuevo."
        case .missingCredentials:
            return "Configura el servidor, el usuario y la contraseña en Ajustes."
        case .unauthorized:
            return "Usuario o contraseña incorrectos. Revisa los datos de Navidrome."
        case .server(let code, _):
            // El mensaje original se conserva en el error tipado. No mostramos texto
            // arbitrario del servidor, que podría incluir datos de la petición.
            switch code {
            case 10: return "El servidor indica que falta un parámetro de la petición."
            case 20, 30: return "La versión de la API del servidor no es compatible."
            case 41: return "El servidor no admite autenticación por token para este usuario."
            case 50: return "Tu usuario no tiene permiso para realizar esta operación."
            case 70: return "El servidor no encontró el recurso solicitado."
            default: return "El servidor rechazó la petición (código \(code))."
            }
        case .httpStatus(let code):
            switch code {
            case 300..<400:
                return "El servidor redirige la petición. Introduce su URL final, preferiblemente HTTPS."
            case 403:
                return "Acceso denegado. Revisa los permisos de Navidrome y del proxy."
            case 404:
                return "No se encontró la API. Revisa la URL base y la ruta de Navidrome."
            default:
                return "El servidor respondió con un error HTTP (\(code))."
            }
        case .invalidResponse, .decoding:
            return "La respuesta no es válida para Subsonic. Revisa que la URL corresponda a Navidrome."
        case .credentialStorage:
            return "No se pudo acceder al llavero. Desbloquea el dispositivo y vuelve a intentarlo."
        case .network(let error):
            switch (error as? URLError)?.code {
            case .timedOut:
                return "El servidor no respondió en 15 segundos. Revisa Tailscale y Navidrome."
            case .notConnectedToInternet, .networkConnectionLost:
                return "No hay conexión con el servidor. Revisa la red y Tailscale."
            case .cannotFindHost, .dnsLookupFailed, .cannotConnectToHost:
                return "No se puede alcanzar el servidor. Revisa su dirección y la conexión de Tailscale."
            case .appTransportSecurityRequiresSecureConnection:
                return "iPadOS bloqueó HTTP. Usa HTTPS o configura una excepción ATS solo para tu dominio."
            case .secureConnectionFailed, .serverCertificateUntrusted,
                 .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot,
                 .serverCertificateNotYetValid:
                return "No se pudo validar el certificado HTTPS del servidor. Revisa su configuración."
            default:
                return "No se pudo conectar con el servidor. Revisa la red y vuelve a intentarlo."
            }
        }
    }
}
