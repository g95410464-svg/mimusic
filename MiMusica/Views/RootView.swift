import SwiftUI

@MainActor
struct RootView: View {
    let settings: SettingsViewModel
    @State private var selection: Destination? = .settings

    private enum Destination: Hashable {
        case settings
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                NavigationLink(value: Destination.settings) {
                    Label("Ajustes", systemImage: "gearshape")
                }
            }
            .navigationTitle("MiMusica")
            .navigationSplitViewColumnWidth(min: 220, ideal: 260)
        } detail: {
            NavigationStack {
                SettingsView(viewModel: settings)
            }
        }
        .tint(.indigo)
    }
}
