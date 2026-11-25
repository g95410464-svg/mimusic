import SwiftUI

@MainActor
struct SettingsView: View {
    @Bindable var viewModel: SettingsViewModel
    @State private var connectionTask: Task<Void, Never>?
    @State private var showDeleteConfirmation = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Servidor") {
                    TextField("https://servidor", text: $viewModel.serverAddress)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .accessibilityLabel("URL del servidor")
                }
                LabeledContent("Usuario") {
                    TextField("Usuario de Navidrome", text: $viewModel.username)
                        .textContentType(.username)
                        .accessibilityLabel("Usuario de Navidrome")
                }
                SecureField(
                    viewModel.hasSavedCredentials ? "Nueva contraseña (opcional)" : "Contraseña",
                    text: $viewModel.password
                )
                .textContentType(.password)
                .accessibilityLabel("Contraseña de Navidrome")
            } header: {
                Text("Tu servidor de música")
            } footer: {
                Text("Introduce la URL base de Navidrome, sin /rest/ping. Si está instalado en una subruta, inclúyela. Conecta Tailscale antes de probar.")
            }
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .disabled(viewModel.isTesting)

            if viewModel.usesHTTP {
                Section {
                    Label("Esta dirección usa HTTP. Prefiere HTTPS; HTTP requiere configurar ATS para tu dominio.", systemImage: "lock.open")
                        .foregroundStyle(.orange)
                }
            }

            Section {
                connectionStatus
                    .accessibilityElement(children: .combine)
                Button {
                    connectionTask = Task { await viewModel.testConnection() }
                } label: {
                    Label("Probar conexión", systemImage: "network")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!viewModel.canTest)
            } footer: {
                Text("Al probar se guardan los datos en el llavero del dispositivo. Deja la contraseña vacía para conservar la guardada; al cambiar de servidor o usuario debes escribirla de nuevo.")
            }

            if viewModel.hasSavedCredentials {
                Section {
                    Button("Borrar credenciales", role: .destructive) {
                        showDeleteConfirmation = true
                    }
                    .disabled(viewModel.isTesting)
                }
            }
        }
        .navigationTitle("Ajustes")
        .task { viewModel.load() }
        .onDisappear {
            connectionTask?.cancel()
            connectionTask = nil
            viewModel.password = ""
        }
        .confirmationDialog("¿Borrar los datos del servidor?", isPresented: $showDeleteConfirmation, titleVisibility: .visible) {
            Button("Borrar credenciales", role: .destructive) { viewModel.forgetCredentials() }
            Button("Cancelar", role: .cancel) {}
        }
    }

    @ViewBuilder
    private var connectionStatus: some View {
        switch viewModel.state {
        case .idle:
            Label("Sin comprobar", systemImage: "circle.dashed")
                .foregroundStyle(.secondary)
        case .testing:
            HStack {
                ProgressView()
                Text("Conectando…")
            }
        case .connected:
            Label("Conectado", systemImage: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case .failed(let message):
            Label(message, systemImage: "exclamationmark.triangle.fill")
                .foregroundStyle(.red)
        }
    }
}
