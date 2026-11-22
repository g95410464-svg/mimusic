import SwiftUI

@main
@MainActor
struct MiMusicaApp: App {
    @State private var settings: SettingsViewModel

    init() {
        let store = KeychainStore()
        let client = SubsonicClient(credentialsStore: store)
        _settings = State(initialValue: SettingsViewModel(store: store, client: client))
    }

    var body: some Scene {
        WindowGroup {
            RootView(settings: settings)
        }
    }
}
