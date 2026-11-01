import DealEngine
import DealOnline
import DealStats
import SwiftUI

/// Host a room, join one by code, or return to the room you were in.
struct OnlineHomeView: View {
    @Environment(AppModel.self) private var app
    @State private var joinCode = ""

    private var nameIsSet: Bool { !app.preferences.onlineName.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        @Bindable var app = app
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            ScrollView {
                VStack(spacing: 16) {
                    VStack(spacing: 8) {
                        SectionTitle(text: "Your Name")
                        TextField("Name", text: $app.preferences.onlineName)
                            .textInputAutocapitalization(.words)
                            .autocorrectionDisabled()
                            .font(.body.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(14)
                            .glassPanel(cornerRadius: 14)
                            .accessibilityIdentifier("online.name")
                    }

                    if let stored = app.storedRoom {
                        VStack(spacing: 8) {
                            SectionTitle(text: "Your Room")
                            VStack(spacing: 10) {
                                Text("Room \(stored.roomCode)")
                                    .font(.title3.weight(.heavy))
                                    .foregroundStyle(.white)
                                Text("You can return to this seat while it's still open.")
                                    .font(.footnote)
                                    .foregroundStyle(.white.opacity(0.7))
                                HStack(spacing: 8) {
                                    Button("Forget") { app.forgetStoredRoom() }
                                        .buttonStyle(SecondaryButtonStyle())
                                    Button("Resume") { Task { await app.resumeStoredRoom() } }
                                        .buttonStyle(PrimaryButtonStyle())
                                        .accessibilityIdentifier("online.resume")
                                }
                            }
                            .padding(14)
                            .glassPanel()
                        }
                    }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Start a Room")
                        Button {
                            Task { await app.hostRoom() }
                        } label: {
                            Label("Host a Room", systemImage: "plus.circle.fill")
                        }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(!nameIsSet || app.onlineBusy)
                        .accessibilityIdentifier("online.host")
                    }

                    VStack(spacing: 8) {
                        SectionTitle(text: "Join a Room")
                        HStack(spacing: 8) {
                            TextField("Room code", text: $joinCode)
                                .textInputAutocapitalization(.characters)
                                .autocorrectionDisabled()
                                .font(.title3.weight(.bold).monospaced())
                                .foregroundStyle(.white)
                                .padding(.horizontal, 14)
                                .frame(minHeight: 50)
                                .glassPanel(cornerRadius: 14)
                                .accessibilityIdentifier("online.code")
                            Button("Join") {
                                Task { await app.joinRoom(code: joinCode) }
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            .frame(width: 96)
                            .disabled(!nameIsSet || joinCode.isEmpty || app.onlineBusy)
                            .accessibilityIdentifier("online.join")
                        }
                    }

                    if app.onlineBusy {
                        HStack(spacing: 8) {
                            ProgressView().tint(.white)
                            Text("Connecting. A sleeping server can take about 20 seconds to wake.")
                                .font(.footnote)
                                .foregroundStyle(.white.opacity(0.8))
                        }
                    }
                    if let error = app.onlineError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.white)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .glassPanel(cornerRadius: 14, tint: Palette.danger.opacity(0.45))
                            .accessibilityIdentifier("online.error")
                    }
                }
                .padding(18)
                .frame(maxWidth: 560)
                .frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Online")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if let code = app.pendingJoinCode {
                joinCode = code
                app.pendingJoinCode = nil
            }
        }
        .onChange(of: app.pendingJoinCode) { _, code in
            if let code {
                joinCode = code
                app.pendingJoinCode = nil
            }
        }
    }
}

/// Everything from the lobby to the rematch for one seat in a room.
struct OnlineGameView: View {
    @Environment(AppModel.self) private var app
    var match: OnlineMatch

    @State private var showChat = false
    @State private var confirmForget = false
    @State private var reactionBurst: RoomReaction?

    var body: some View {
        ZStack {
            if let view = match.view {
                content(view)
            } else {
                TableBackground(style: app.preferences.tableStyle)
                ProgressView("Joining the room").tint(.white).foregroundStyle(.white)
            }
            if let reaction = reactionBurst {
                ReactionBurst(reaction: reaction)
                    .transition(.scale.combined(with: .opacity))
                    .allowsHitTesting(false)
            }
        }
        .sheet(isPresented: $showChat) {
            ChatSheet(match: match)
                .presentationDetents([.medium, .large])
                .presentationBackground(.ultraThinMaterial)
        }
        .confirmationDialog("Give up your seat in this room for good?", isPresented: $confirmForget, titleVisibility: .visible) {
            Button("Forget Room", role: .destructive) { Task { await app.forgetRoom() } }
                .accessibilityIdentifier("room.forgetConfirm")
            Button("Cancel", role: .cancel) {}
        }
        .onChange(of: match.view) {
            match.observeChange()
            if match.connection.endedReason != nil { app.handleSeatLost() }
        }
        .onChange(of: match.view?.activityFeed.last?.id) {
            guard let latest = match.view?.activityFeed.last, let reaction = latest.reaction else { return }
            withAnimation(.snappy) { reactionBurst = reaction }
            Task {
                try? await Task.sleep(for: .seconds(1.6))
                withAnimation(.easeOut) { reactionBurst = nil }
            }
        }
    }

    @ViewBuilder
    private func content(_ view: RoomView) -> some View {
        if let summary = match.summary, let game = match.game, view.isFinished {
            PostGameView(
                summary: summary,
                game: game,
                unlocked: match.unlocked,
                primaryTitle: view.canRematch ? "Rematch" : (view.players.first { $0.id == view.yourPlayerId }?.ready == true ? nil : "Ready for Rematch"),
                onPrimary: { rematchTapped(view) },
                onClose: { Task { await app.exitRoom() } }
            )
        } else if view.started, view.gameState != nil {
            TableView(session: match, extras: AnyView(roomBar(view))) {
                Task { await app.exitRoom() }
            }
        } else {
            RoomLobbyView(match: match, onChat: { showChat = true }, onForget: { confirmForget = true })
        }
    }

    private func rematchTapped(_ view: RoomView) {
        Task {
            await match.connection.run { client, session, revision in
                if view.canRematch {
                    try await client.rematch(session, expectedRevision: revision)
                } else {
                    try await client.setReady(session, ready: true, expectedRevision: revision)
                }
            }
        }
    }

    private func roomBar(_ view: RoomView) -> some View {
        HStack(spacing: 8) {
            ConnectionPill(status: match.connection.status)
            Text("Room \(view.roomCode)")
                .font(.caption.weight(.heavy).monospaced())
                .foregroundStyle(.white.opacity(0.8))
            Spacer()
            Menu {
                ForEach(RoomReaction.allCases, id: \.self) { reaction in
                    Button(reaction.label, systemImage: reaction.symbol) {
                        Task { await match.connection.run { client, session, revision in try await client.sendReaction(session, reaction, expectedRevision: revision) } }
                    }
                }
            } label: {
                Image(systemName: "face.smiling")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 32)
                    .glassEffect(.regular.interactive(), in: Capsule())
            }
            .accessibilityLabel("Send a reaction")
            Button {
                showChat = true
            } label: {
                Image(systemName: "bubble.left.and.bubble.right.fill")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 32)
                    .glassEffect(.regular.interactive(), in: Capsule())
                    .overlay(alignment: .topTrailing) {
                        if match.unreadChat > 0 {
                            Text("\(match.unreadChat)")
                                .font(.caption2.weight(.heavy))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 5)
                                .background(Capsule().fill(Palette.danger))
                                .offset(x: 5, y: -5)
                        }
                    }
            }
            .accessibilityLabel(match.unreadChat > 0 ? "Chat, \(match.unreadChat) unread" : "Chat")
            .accessibilityIdentifier("room.chat")
            if view.isHost {
                Menu {
                    Button("Save Checkpoint", systemImage: "bookmark") {
                        let name = "Turn \(view.gameState?.turnCount ?? 0)"
                        Task { await match.connection.run { client, session, revision in try await client.saveCheckpoint(session, name: name, expectedRevision: revision) } }
                    }
                    ForEach(view.checkpointSlots) { checkpoint in
                        Button("Load \(checkpoint.name)", systemImage: "arrow.uturn.backward") {
                            let id = checkpoint.id
                            Task { await match.connection.run { client, session, revision in try await client.loadCheckpoint(session, id: id, expectedRevision: revision) } }
                        }
                    }
                } label: {
                    Image(systemName: "bookmark.fill")
                        .font(.subheadline)
                        .foregroundStyle(.white)
                        .frame(width: 36, height: 32)
                        .glassEffect(.regular.interactive(), in: Capsule())
                }
                .accessibilityLabel("Checkpoints")
            }
            Button {
                confirmForget = true
            } label: {
                Image(systemName: "rectangle.portrait.and.arrow.right")
                    .font(.subheadline)
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 32)
                    .glassEffect(.regular.interactive(), in: Capsule())
            }
            .accessibilityLabel("Forget Room")
            .accessibilityIdentifier("room.forget")
        }
    }
}

struct ConnectionPill: View {
    var status: RoomConnection.Status

    private var label: (String, Color) {
        switch status {
        case .live: ("Live", Palette.success)
        case .polling: ("Connected", Palette.success)
        case .connecting: ("Connecting", Palette.gold)
        case .reconnecting: ("Reconnecting", Palette.gold)
        case .disconnected: ("Offline", Palette.danger)
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            Circle().fill(label.1).frame(width: 7, height: 7)
            Text(label.0)
                .font(.caption2.weight(.heavy))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 8)
        .frame(height: 24)
        .glassEffect(.regular, in: Capsule())
        .accessibilityIdentifier("room.connection")
    }
}

private struct ReactionBurst: View {
    var reaction: RoomReaction

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: reaction.symbol)
                .font(.system(size: 54, weight: .bold))
                .foregroundStyle(Palette.gold)
                .symbolEffect(.bounce, options: .nonRepeating)
            Text(reaction.label)
                .font(.title2.weight(.black))
                .foregroundStyle(.white)
        }
        .padding(26)
        .glassPanel(cornerRadius: 30)
    }
}

struct RoomLobbyView: View {
    @Environment(AppModel.self) private var app
    var match: OnlineMatch
    var onChat: () -> Void
    var onForget: () -> Void

    private var view: RoomView? { match.view }
    private var you: RoomPlayer? { view.flatMap { room in room.players.first { $0.id == room.yourPlayerId } } }

    var body: some View {
        ZStack {
            TableBackground(style: app.preferences.tableStyle)
            if let view {
                ScrollView {
                    VStack(spacing: 14) {
                        header(view)
                        roster(view)
                        if view.isHost { hostControls(view) } else { guestSummary(view) }
                        actions(view)
                        if !view.activityFeed.isEmpty { activity(view) }
                        if let error = match.errorMessage {
                            Label(error, systemImage: "exclamationmark.triangle.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(12)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .glassPanel(cornerRadius: 14, tint: Palette.danger.opacity(0.45))
                        }
                    }
                    .padding(18)
                    .frame(maxWidth: 560)
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    private func header(_ view: RoomView) -> some View {
        VStack(spacing: 8) {
            HStack {
                Button {
                    Task { await app.exitRoom() }
                } label: {
                    Image(systemName: "chevron.backward")
                        .font(.headline.weight(.bold))
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .glassEffect(.regular.interactive(), in: Circle())
                }
                .accessibilityLabel("Exit room")
                .accessibilityIdentifier("room.exit")
                Spacer()
                ConnectionPill(status: match.connection.status)
                Button(action: onChat) {
                    Image(systemName: "bubble.left.and.bubble.right.fill")
                        .foregroundStyle(.white)
                        .frame(width: 42, height: 42)
                        .glassEffect(.regular.interactive(), in: Circle())
                }
                .accessibilityLabel("Chat")
            }
            Text("ROOM CODE")
                .font(.caption.weight(.heavy))
                .tracking(1.2)
                .foregroundStyle(.white.opacity(0.6))
            Text(view.roomCode)
                .font(.system(size: 46, weight: .black, design: .monospaced))
                .foregroundStyle(Palette.gold)
                .textSelection(.enabled)
                .accessibilityIdentifier("room.code")
            ShareLink(item: inviteText(view), subject: Text("Join my Monopoly Deal room")) {
                Label("Invite Friends", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("room.invite")
        }
    }

    private func inviteText(_ view: RoomView) -> String {
        "Join my Monopoly Deal room. The code is \(view.roomCode).\nOn iPhone: monopolydeal://join/\(view.roomCode)"
    }

    private func roster(_ view: RoomView) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionTitle(text: "Players (\(view.players.count)/5)")
            ForEach(view.players) { player in
                HStack(spacing: 10) {
                    PlayerAvatar(name: player.name, isBot: false)
                    Text(player.name)
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(.white)
                    if player.isHost {
                        Image(systemName: "crown.fill")
                            .font(.caption2)
                            .foregroundStyle(Palette.gold)
                            .accessibilityLabel("Host")
                    }
                    if player.id == view.yourPlayerId {
                        Text("You").font(.caption2.weight(.heavy)).foregroundStyle(.white.opacity(0.6))
                    }
                    Spacer()
                    if !player.connected {
                        Label("Away", systemImage: "wifi.slash")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Palette.danger)
                    } else if player.ready {
                        Label("Ready", systemImage: "checkmark.circle.fill")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(Palette.success)
                    } else {
                        Text("Not ready")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.white.opacity(0.55))
                    }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private func hostControls(_ view: RoomView) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionTitle(text: "Room Settings")
            Picker("Game", selection: Binding(
                get: { view.variant ?? .classic },
                set: { variant in
                    Task { await match.connection.run { client, session, revision in try await client.setVariant(session, variant, expectedRevision: revision) } }
                }
            )) {
                ForEach(GameVariant.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("room.variant")
            if (view.variant ?? .classic) == .classic {
                Picker("Pace", selection: Binding(
                    get: { view.presetId },
                    set: { preset in
                        Task { await match.connection.run { client, session, revision in try await client.setPreset(session, preset, expectedRevision: revision) } }
                    }
                )) {
                    ForEach(RoomPreset.allCases, id: \.self) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("room.preset")
                Text(view.presetId.summary)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.7))
            }
            if !view.checkpointSlots.isEmpty {
                SectionTitle(text: "Start From a Checkpoint")
                ForEach(view.checkpointSlots) { checkpoint in
                    HStack {
                        Text(checkpoint.name).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                        Spacer()
                        Button("Start") {
                            let id = checkpoint.id
                            Task { await match.connection.run { client, session, revision in try await client.start(session, checkpointId: id, expectedRevision: revision) } }
                        }
                        .buttonStyle(.glass)
                        Button(role: .destructive) {
                            let id = checkpoint.id
                            Task { await match.connection.run { client, session, revision in try await client.deleteCheckpoint(session, id: id, expectedRevision: revision) } }
                        } label: {
                            Image(systemName: "trash")
                        }
                        .accessibilityLabel("Delete \(checkpoint.name)")
                    }
                }
            }
        }
        .padding(14)
        .glassPanel(cornerRadius: 18)
    }

    private func guestSummary(_ view: RoomView) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            SectionTitle(text: "Room Settings")
            Text("\((view.variant ?? .classic).label) · \(view.presetId.label)")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.white)
            Text("The host chooses these.")
                .font(.caption)
                .foregroundStyle(.white.opacity(0.65))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(cornerRadius: 18)
    }

    private func actions(_ view: RoomView) -> some View {
        VStack(spacing: 8) {
            Button(you?.ready == true ? "Not Ready" : "I'm Ready") {
                let ready = !(you?.ready ?? false)
                Task { await match.connection.run { client, session, revision in try await client.setReady(session, ready: ready, expectedRevision: revision) } }
            }
            .buttonStyle(SecondaryButtonStyle())
            .accessibilityIdentifier("room.ready")
            if view.isHost {
                Button {
                    Task { await match.connection.run { client, session, revision in try await client.start(session, expectedRevision: revision) } }
                } label: {
                    Label("Start Match", systemImage: "play.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!view.canStart)
                .accessibilityIdentifier("room.start")
                if !view.canStart {
                    Text("Everyone needs to be here and ready, with at least 2 players.")
                        .font(.caption)
                        .foregroundStyle(.white.opacity(0.65))
                }
            }
            Button("Forget Room", role: .destructive, action: onForget)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Palette.danger)
                .accessibilityIdentifier("room.forget")
        }
    }

    private func activity(_ view: RoomView) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionTitle(text: "Activity")
            ForEach(view.activityFeed.suffix(6).reversed()) { item in
                Text(item.message)
                    .font(.caption)
                    .foregroundStyle(.white.opacity(0.75))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .glassPanel(cornerRadius: 18)
    }
}

struct ChatSheet: View {
    var match: OnlineMatch
    @State private var text = ""
    @State private var typingSent = false
    @FocusState private var focused: Bool

    private var view: RoomView? { match.view }

    private var typingNames: [String] {
        guard let view else { return [] }
        return view.typingPlayerIds
            .filter { $0 != view.yourPlayerId }
            .compactMap { id in view.players.first { $0.id == id }?.name }
    }

    var body: some View {
        VStack(spacing: 0) {
            Text("Room Chat")
                .font(.headline.weight(.bold))
                .padding(.top, 16)
                .padding(.bottom, 8)
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 8) {
                        ForEach(view?.chatMessages ?? []) { message in
                            bubble(message).id(message.id)
                        }
                    }
                    .padding(.horizontal, 14)
                }
                .defaultScrollAnchor(.bottom)
                .onChange(of: view?.chatMessages.last?.id) { _, latest in
                    if let latest { withAnimation { proxy.scrollTo(latest, anchor: .bottom) } }
                }
            }
            if !typingNames.isEmpty {
                Text("\(typingNames.joined(separator: ", ")) typing...")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.top, 4)
            }
            HStack(spacing: 8) {
                TextField("Message", text: $text)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(send)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 42)
                    .glassEffect(.regular, in: Capsule())
                    .accessibilityIdentifier("chat.field")
                Button(action: send) {
                    Image(systemName: "arrow.up.circle.fill").font(.title)
                }
                .disabled(text.trimmingCharacters(in: .whitespaces).isEmpty)
                .accessibilityLabel("Send")
                .accessibilityIdentifier("chat.send")
            }
            .padding(12)
        }
        .onAppear { match.chatOpen = true }
        .onDisappear {
            match.chatOpen = false
            setTyping(false)
        }
        .onChange(of: text) { _, value in setTyping(!value.isEmpty) }
    }

    private func bubble(_ message: RoomChatMessage) -> some View {
        let mine = message.playerId == view?.yourPlayerId
        let name = view?.players.first { $0.id == view?.yourPlayerId }?.name ?? ""
        let mentionsYou = !mine && !name.isEmpty && message.text.localizedCaseInsensitiveContains("@\(name)")
        return VStack(alignment: mine ? .trailing : .leading, spacing: 2) {
            if !mine {
                Text(message.playerName).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            }
            Text(message.text)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(mine ? Palette.gold.opacity(0.32) : (mentionsYou ? Palette.danger.opacity(0.3) : Color.white.opacity(0.12)))
                )
        }
        .frame(maxWidth: .infinity, alignment: mine ? .trailing : .leading)
    }

    private func send() {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        text = ""
        Task { await match.connection.run { client, session, _ in try await client.sendChat(session, text: trimmed) } }
    }

    private func setTyping(_ typing: Bool) {
        guard typing != typingSent else { return }
        typingSent = typing
        Task { await match.connection.run { client, session, _ in try await client.setTyping(session, typing: typing) } }
    }
}
