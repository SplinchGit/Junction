package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DeleteOutline
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Pause
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.sync.lan.DeviceCommandSync
import com.splinch.junction.data.sync.lan.NethraClient
import com.splinch.junction.app.JunctionApplication
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/** The phone controls durable objectives on its paired Windows host. */
@Composable
fun NethraPanel(modifier: Modifier = Modifier, initialGoal: String? = null, initialTaskId: String? = null, initialApprovalId: String? = null, conversationId: String? = null, onInitialGoalConsumed: () -> Unit = {}, onOpenChat: (String) -> Unit = {}, requestTask: (suspend (String, Map<String, Any?>) -> Map<String, Any?>)? = null, openInitialTaskChat: Boolean = false, onInitialTaskChatConsumed: () -> Unit = {}, initialInvitationQuestionId: String? = null, initialInvitationCommandId: String? = null, onInvitationChatOpened: (String) -> Unit = onOpenChat) {
    val context = LocalContext.current
    val client = remember(context) { NethraClient(context) }
    suspend fun request(type: String, payload: Map<String, Any?> = emptyMap()): Map<String, Any?> = requestTask?.invoke(type, payload) ?: client.request(type, payload)
    val deviceSync = remember(context) { DeviceCommandSync(context) }
    var consents by remember { mutableStateOf(deviceSync.pendingConsents()) }
    val scope = rememberCoroutineScope()
    var goal by rememberSaveable { mutableStateOf("") }
    var criteria by rememberSaveable { mutableStateOf("") }
    var persistent by rememberSaveable { mutableStateOf(true) }
    var taskModel by rememberSaveable { mutableStateOf("qwen3:30b") }
    val taskModels = listOf("qwen3:30b" to "Qwen3 30B · faster", "junction-qwen3-next:80b-q3km" to "Qwen3-Next 80B · deeper, slower")
    var mode by rememberSaveable { mutableStateOf("FINITE") }
    var autonomy by rememberSaveable { mutableStateOf("BALANCED") }
    var priority by rememberSaveable { mutableIntStateOf(3) }
    var checkIn by rememberSaveable { mutableStateOf("WEEKLY") }
    var watchCalendar by rememberSaveable { mutableStateOf(false) }
    var watchGmail by rememberSaveable { mutableStateOf(false) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    var quickEditId by rememberSaveable { mutableStateOf<String?>(null) }
    var quickDeleteId by rememberSaveable { mutableStateOf<String?>(null) }
    val taskScroll = rememberScrollState()
    var objectives by remember { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var settings by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var hostStatus by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var reunion by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var detail by remember { mutableStateOf<Map<*, *>?>(null) }
    var detailError by remember { mutableStateOf("") }
    var detailLoading by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var connected by remember { mutableStateOf(false) }
    var lastSyncedAt by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf("") }
    var answer by rememberSaveable(selectedId) { mutableStateOf("") }
    var diagnosticCursor by remember(selectedId) { mutableStateOf<Map<String, Any?>?>(mapOf("seq" to 0, "offset" to 0)) }
    var diagnosticEvents by remember(selectedId) { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var diagnosticsLoading by remember(selectedId) { mutableStateOf(false) }
    var showHistory by rememberSaveable(selectedId) { mutableStateOf(false) }
    val detailGate = remember { ObjectiveRefreshGate() }
    var showAllEnded by rememberSaveable { mutableStateOf(false) }
    var showCreate by rememberSaveable { mutableStateOf(!initialGoal.isNullOrBlank()) }
    var showHostDetails by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(initialGoal) {
        if (!initialGoal.isNullOrBlank()) {
            goal = initialGoal
            showCreate = true
            onInitialGoalConsumed()
        }
    }
    LaunchedEffect(initialTaskId) { if (initialTaskId != null) selectedId = initialTaskId }
    LaunchedEffect(selectedId) { taskScroll.scrollTo(0) }
    LaunchedEffect(Unit) {
        ObjectiveStatusMonitor.restore(context)
        objectives = ObjectiveStatusMonitor.objectives.value
        lastSyncedAt = ObjectiveStatusMonitor.lastSyncedAt.value
    }

    suspend fun loadDetail(id: String) {
        detailLoading = true
        val ticket = detailGate.begin()
        val snapshotTicket = ObjectiveStatusMonitor.beginRefresh()
        try {
            val approvalId = initialApprovalId?.takeIf { id == initialTaskId }
            val response = request("nethra.get", if (approvalId == null) mapOf("id" to id) else mapOf("id" to id, "approvalId" to approvalId))
            if (selectedId == id && detailGate.accepts(ticket) && ObjectiveStatusMonitor.accepts(snapshotTicket)) {
                detail = response
                detailError = ""
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            if (selectedId == id) detailError = failure.message ?: "Could not load this task's work log."
        } finally { if (selectedId == id) detailLoading = false }
    }
    suspend fun refresh(status: Boolean = false) {
        selectedId?.let { loadDetail(it) }
        val ticket = ObjectiveStatusMonitor.beginRefresh()
        val response = request("nethra.list")
        var rows = maps(response["objectives"])
        var next = response["nextOffset"] as? Number
        while (next != null) {
            val page = request("nethra.list", mapOf("offset" to next.toInt()))
            rows = rows + maps(page["objectives"])
            next = page["nextOffset"] as? Number
        }
        rows = rows.distinctBy { it["id"] }
        if (!ObjectiveStatusMonitor.publish(context, rows, ticket)) return
        objectives = rows
        settings = response["settings"] as? Map<*, *> ?: emptyMap<String, Any?>()
        if (status) {
            hostStatus = request("nethra.status")
            reunion = request("nethra.reunion", mapOf("since" to System.currentTimeMillis() - 86_400_000L))
        }
        connected = true
        lastSyncedAt = System.currentTimeMillis()
    }
    fun perform(type: String, payload: Map<String, Any?>) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                val result = request(type, payload)
                result["clarification"]?.toString()?.let { error = it; return@launch }
                if (type == "nethra.edit") quickEditId = null
                if (type == "nethra.create") {
                    selectedId = (result["task"] as? Map<*, *>)?.get("id")?.toString()
                    goal = ""; criteria = ""
                }
                if (type == "nethra.agent.create") selectedId = (result["task"] as? Map<*, *>)?.get("id")?.toString()
                if (type == "nethra.answer") answer = ""
                if (type == "nethra.delete" && result["deleted"] == true) {
                    val deletedId = payload["id"].toString()
                    detailGate.invalidate()
                    objectives = objectives.filterNot { it["id"]?.toString() == deletedId }
                    if (selectedId == deletedId) { selectedId = null; detail = null }
                    ObjectiveStatusMonitor.removeAcknowledged(context, deletedId)
                }
                error = ""
                try { refresh() } catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) {
                    connected = false
                    error = if (type == "nethra.delete") "Task deleted. The latest list could not be refreshed." else "Saved on your PC. Refresh to load the latest state."
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                error = failure.message ?: "The PC did not confirm the request. Refresh to check its saved state."
                // Refresh is read-only; retrying this same request keeps its identity.
                try { refresh() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { connected = false; ObjectiveStatusMonitor.disconnected() }
            } finally { busy = false }
        }
    }
    fun openTaskChat(id: String, invitationQuestionId: String? = null, invitationCommandId: String? = null) {
        if (busy) return
        scope.launch {
            busy = true
            try {
                val result = request("nethra.openChat", buildMap {
                    put("id", id)
                    if (invitationQuestionId != null) {
                        put("invitationQuestionId", invitationQuestionId)
                        put("invitationCommandId", invitationCommandId)
                        put("deviceId", com.splinch.junction.data.sync.lan.LanIdentityStore(context).deviceId())
                    }
                })
                (result["invitationEventId"] as? String)?.let { eventId ->
                    androidx.core.app.NotificationManagerCompat.from(context).cancel(eventId, 0)
                }
                val taskConversationId = result["conversationId"]?.toString() ?: error("PC did not return a chat")
                val app = context.applicationContext as JunctionApplication
                if (app.container.database.chatDao().getSessionById(taskConversationId) == null) app.container.pairedConversationSyncManager.syncNow()
                check(app.container.database.chatDao().getSessionById(taskConversationId) != null) { "Task chat is not synced yet. Try again after conversation sync completes." }
                if (invitationQuestionId != null) onInvitationChatOpened(taskConversationId) else onOpenChat(taskConversationId)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = failure.message ?: "Could not open the task chat" }
            finally { busy = false }
        }
    }
    LaunchedEffect(openInitialTaskChat, initialTaskId) {
        if (openInitialTaskChat && initialTaskId != null) {
            onInitialTaskChatConsumed()
            openTaskChat(initialTaskId, initialInvitationQuestionId, initialInvitationCommandId)
        }
    }
    LaunchedEffect(Unit) {
        // Signed PC device commands; failures stay silent here and retry next minute.
        while (true) {
            try { deviceSync.runOnce() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) {}
            consents = deviceSync.pendingConsents()
            delay(NethraClient.pollIntervalMs(60_000))
        }
    }
    LaunchedEffect(selectedId) {
        detailGate.invalidate()
        detail = null
        detailError = ""
        detailLoading = selectedId != null
        while (true) {
            var refreshFailed = false
            if (!busy) {
                try { refresh(status = hostStatus.isEmpty()); error = "" }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { refreshFailed = true; connected = false; ObjectiveStatusMonitor.disconnected(); error = failure.message ?: "The paired Windows host is unavailable."; detailLoading = false; if (selectedId != null && detail == null) detailError = error }
            }
            delay(if (!refreshFailed && NethraClient.lastTransport == NethraClient.Transport.LAN) { if (selectedId != null || objectives.any { it["parentId"] != null && !ObjectiveStatus.of(it).ended }) 3_000L else 60_000L } else 180_000L)
        }
    }

    OutlinedCard(modifier.fillMaxWidth(), shape = RoundedCornerShape(4.dp)) {
        if (selectedId != null) {
            val headerTask = (detail?.get("task") as? Map<*, *>)?.takeIf { it["id"]?.toString() == selectedId }
                ?: objectives.firstOrNull { it["id"]?.toString() == selectedId }
            TaskDetailHeader(headerTask, connected, busy,
                onBack = { detailGate.invalidate(); selectedId = null; detail = null },
                onChat = { selectedId?.let { openTaskChat(it) } },
                onControl = { headerTask?.let { perform("nethra.control", mapOf("id" to selectedId, "revision" to it["revision"], "action" to if (it["status"] == "PAUSED") "resume" else "pause")) } },
                onEdit = { quickEditId = selectedId; scope.launch { taskScroll.scrollTo(0) } },
                onDelete = { quickDeleteId = selectedId })
        }
        Column(Modifier.weight(1f, fill = false).verticalScroll(taskScroll).padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            val withStatus = objectives.map { it to ObjectiveStatus.of(if (connected) it else it.filterKeys { key -> key != "live" }) }
            val open = withStatus.filterNot { it.second.ended }.sortedBy { it.second.light.ordinal }
            val allEnded = withStatus.filter { it.second.ended }
            val ended = if (showAllEnded) allEnded else allEnded.take(5)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            if (selectedId == null) {
            Text("Objectives", style = MaterialTheme.typography.titleLarge)
            Text("Active commitments and decisions from your paired PC.")
            Text(if (connected) "Connected to your Windows host" else if (lastSyncedAt != null) "Offline · last synced ${dateLabel(lastSyncedAt)}. This view may be stale." else "Offline · connect to your Windows host to load objectives.")
            OutlinedButton(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    try { refresh(status = true); error = "" }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { connected = false; ObjectiveStatusMonitor.disconnected(); error = failure.message ?: "Refresh failed" }
                    finally { busy = false }
                }
            }) { Text("Refresh objectives") }
            val thisDevice = remember(context) { com.splinch.junction.data.sync.lan.LanIdentityStore(context).deviceId() }
            NotificationPreferences(settings, thisDevice, connected && !busy) { patch -> perform("nethra.settings", patch) }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("Full task agents")
                    Text(if (connected && "taskAgentsEnabled" !in settings) "Update Junction on Windows to manage full task agents here." else "Launch agents from task details. Turning this off pauses their work.", style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = settings["taskAgentsEnabled"] == true, enabled = connected && !busy && "taskAgentsEnabled" in settings,
                    onCheckedChange = { perform("nethra.settings", mapOf("taskAgentsEnabled" to it)) })
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("Read-only research helpers")
                    Text("Let Nethra delegate bounded read-only research. You can stop a helper in its task.", style = MaterialTheme.typography.bodySmall)
                }
                Switch(checked = settings["childDelegation"] == true, enabled = connected && !busy && "childDelegation" in settings,
                    onCheckedChange = { perform("nethra.settings", mapOf("childDelegation" to it)) })
            }
            TextButton(onClick = { showHostDetails = !showHostDetails }) { Text(if (showHostDetails) "Hide PC status" else "PC status and sources") }
            if (showHostDetails) {
            val thinkingRequired = hostStatus["thinkingRequired"] == true
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Column(Modifier.weight(1f)) {
                    Text("Thinking", style = MaterialTheme.typography.titleMedium)
                    Text(if (thinkingRequired) "Always on with Qwen3 30B." else "Saved on your PC for conversations and objectives.")
                }
                Switch(checked = thinkingRequired || settings["thinking"] == true, enabled = connected && !busy && !thinkingRequired,
                    onCheckedChange = { perform("nethra.settings", mapOf("thinking" to it)) })
            }
            val capability = hostStatus["capabilities"] as? Map<*, *>
            if (capability != null && capability["thinking"] != true) Text(if (capability["known"] == true) "This model does not support thinking; it will answer normally." else "Model thinking support could not be confirmed; the PC will use its supported mode.")
            if (hostStatus.isNotEmpty()) {
                val sources = hostStatus["sources"] as? Map<*, *>
                for ((key, label) in listOf("calendar" to "Google Calendar", "gmail" to "Gmail (headers only)")) {
                    val state = sources?.get(key) as? Map<*, *>
                    Text(when (state?.get("status")) {
                        "CONNECTED" -> "PC $label: connected read-only · last checked ${dateLabel(state["lastSyncAt"])}"
                        "STALE" -> "PC $label: connected but not checked recently"
                        "ERROR" -> "PC $label: ${state["error"] ?: "needs attention on Windows"}"
                        else -> "PC $label: not connected (connect it on Windows)"
                    })
                }
            }
            if (settings.isNotEmpty()) Text("Windows startup: ${if (settings["persistentStartup"] == true) "enabled" else "disabled"}. Change startup on the PC.")
            if (reunion.isNotEmpty()) {
                Text("Since you were away", style = MaterialTheme.typography.titleMedium)
                val activeCount = objectives.count { it["status"] !in setOf("COMPLETED", "CANCELLED", "FAILED") }
                Text("${reunion["pendingApprovals"] ?: 0} approval(s) waiting · $activeCount active objective(s)")
            }
            }
            consents.forEach { consent ->
                OutlinedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Install Junction build ${consent.versionCode}?", style = MaterialTheme.typography.titleMedium)
                        Text("Requested by ${consent.requestedBy} on your PC · ${consent.sizeBytes / 1_048_576} MB · SHA-256 ${consent.sha256.take(12)}…")
                        Text("Approving lets your PC install exactly this build over ADB. Your data is kept.")
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(enabled = !busy, onClick = { scope.launch { runCatching { deviceSync.decide(consent.id, true) }.onFailure { error = it.message.orEmpty() }; consents = deviceSync.pendingConsents() } }) { Text("Approve install") }
                            OutlinedButton(enabled = !busy, onClick = { scope.launch { runCatching { deviceSync.decide(consent.id, false) }.onFailure { error = it.message.orEmpty() }; consents = deviceSync.pendingConsents() } }) { Text("Reject") }
                        }
                    }
                }
            }
            var continuousNew by remember { mutableStateOf(true) }
            TextButton(onClick = { showCreate = !showCreate }) { Text(if (showCreate) "Hide new task" else "New task") }
            if (showCreate) {
            HorizontalDivider()
            OutlinedTextField(goal, { if (it.length <= 12_000) goal = it }, label = { Text("What should Nethra achieve?") }, minLines = 2, modifier = Modifier.fillMaxWidth(), enabled = !busy)
            OutlinedTextField(criteria, { if (it.length <= 10_000) criteria = it }, label = { Text("Success criteria (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
            Row {
                Checkbox(checked = continuousNew, onCheckedChange = { continuousNew = it }, enabled = !busy)
                Text("Keep working continuously until done", Modifier.padding(top = 12.dp))
            }
            Row {
                Checkbox(checked = persistent, onCheckedChange = { persistent = it }, enabled = !busy)
                Text("Keep this objective active between runs", Modifier.padding(top = 12.dp))
            }
            PolicyChoice("Task model", taskModel, taskModels, !busy) { taskModel = it }
            PolicyChoice("Objective type", mode, listOf("FINITE" to "Finish when achieved", "ONGOING" to "Keep monitoring after each result"), !busy) { mode = it }
            PolicyChoice("Autonomy", autonomy, listOf("QUIET" to "Quiet monitoring", "BALANCED" to "Balanced initiative", "ACTIVE" to "Active exploration"), !busy) { autonomy = it }
            PolicyChoice("Priority", priority.toString(), (1..5).map { it.toString() to "$it · ${if (it == 1) "Highest" else if (it == 5) "Lowest" else "Priority"}" }, !busy) { priority = it.toInt() }
            PolicyChoice("Direction check-in", checkIn, listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MILESTONES" to "At milestones or blockers", "MANUAL" to "Manual only"), !busy) { checkIn = it }
            Row {
                Checkbox(checked = watchCalendar, onCheckedChange = { watchCalendar = it }, enabled = !busy)
                Text("Watch my Google Calendar (read-only, via the PC)", Modifier.padding(top = 12.dp))
            }
            Row {
                Checkbox(checked = watchGmail, onCheckedChange = { watchGmail = it }, enabled = !busy)
                Text("Watch new Gmail inbox mail (headers only, via the PC)", Modifier.padding(top = 12.dp))
            }
            Text("Your PC must be awake and online to run work. Nethra asks for approval before actions that need your permission.")
            Button(enabled = !busy && goal.isNotBlank(), onClick = {
                perform("nethra.create", buildMap { put("goal", goal.trim()); conversationId?.let { put("conversationId", it) }; put("persistent", persistent); put("continuous", continuousNew); put("model", taskModel); put("mode", mode); put("autonomy", autonomy); put("priority", priority); put("checkIn", checkIn); listOfNotNull("calendar".takeIf { watchCalendar }, "gmail".takeIf { watchGmail }).takeIf { it.isNotEmpty() }?.let { put("sources", it) }; if (criteria.isNotBlank()) put("successCriteria", criteria.trim()) })
            }) { Text(if (busy) "Contacting PC…" else "Create objective") }
            }
            // Open work first, then recent history. Older tasks stay reachable for manual deletion.
            }
            if (quickDeleteId != null) {
                AlertDialog(
                    onDismissRequest = { quickDeleteId = null },
                    title = { Text("Delete this task?") },
                    text = { Text("Its history and drafts are removed from the PC. Its chat is kept. This cannot be undone.") },
                    confirmButton = { TextButton(onClick = { val id = quickDeleteId; quickDeleteId = null; if (id != null) perform("nethra.delete", mapOf("id" to id, "confirm" to true)) }) { Text("Delete") } },
                    dismissButton = { TextButton(onClick = { quickDeleteId = null }) { Text("Keep it") } }
                )
            }
            if (selectedId == null) {
                if (open.isEmpty()) Text("Nethra has no open tasks. Ask her in chat to look after something.")
                (open + ended).forEach { (objective, status) ->
                    val id = objective["id"]?.toString() ?: return@forEach
                    Column(
                        Modifier.fillMaxWidth()
                            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(4.dp))
                            .clickable(enabled = !busy) { selectedId = id }
                            .padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            StatusDot(status.light)
                            Spacer(Modifier.width(8.dp))
                            Text(if (objective["parentId"] != null) "Agent · ${status.label}" else status.label, style = MaterialTheme.typography.labelLarge)
                        }
                        Text(objective["goal"]?.toString().orEmpty(), style = MaterialTheme.typography.titleSmall, maxLines = 2)
                        val tracking = objective["tracking"] as? Map<*, *>
                        tracking?.get("doing")?.toString()?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2) }
                        ObjectiveStatus.stepLine(objective)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        val revision = (objective["revision"] as? Number)?.toLong() ?: -1L
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            if (!status.ended) {
                                Text("Continuous", style = MaterialTheme.typography.labelSmall)
                                Switch(checked = objective["continuous"] == true, modifier = Modifier.padding(start = 4.dp).height(32.dp), enabled = !busy && connected, onCheckedChange = { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "continuous" to it)) })
                                Spacer(Modifier.weight(1f))
                                IconButton(enabled = !busy && connected, onClick = { perform("nethra.control", mapOf("id" to id, "action" to if (objective["status"] == "PAUSED") "resume" else "pause", "revision" to revision)) }) { Icon(if (objective["status"] == "PAUSED") Icons.Default.PlayArrow else Icons.Default.Pause, contentDescription = if (objective["status"] == "PAUSED") "Resume task" else "Pause task", modifier = Modifier.size(20.dp)) }
                                IconButton(enabled = !busy, onClick = { quickEditId = id; selectedId = id }) { Icon(Icons.Default.Edit, contentDescription = "Edit task", modifier = Modifier.size(20.dp)) }
                            } else {
                                Spacer(Modifier.weight(1f))
                            }
                            if (status.ended) IconButton(enabled = !busy, onClick = { quickEditId = id; selectedId = id }) { Icon(Icons.Default.Edit, contentDescription = "Edit task") }
                            IconButton(enabled = !busy && connected, onClick = { quickDeleteId = id }) { Icon(Icons.Default.DeleteOutline, contentDescription = "Delete task", modifier = Modifier.size(20.dp)) }
                        }
                        Row {
                            TextButton(enabled = !busy && connected, onClick = { openTaskChat(id) }) { Text("Open conversation") }
                            TextButton(enabled = !busy, onClick = { selectedId = id }) { Text("View details") }
                        }
                    }
                }
                if (allEnded.size > 5) TextButton(onClick = { showAllEnded = !showAllEnded }) {
                    Text(if (showAllEnded) "Show fewer previous tasks" else "Show all ${allEnded.size} previous tasks")
                }
            }
            val task = detail?.get("task") as? Map<*, *>
            if (selectedId != null && task == null) {
                val cached = objectives.firstOrNull { it["id"]?.toString() == selectedId }
                cached?.get("goal")?.toString()?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
                if (detailError.isNotBlank()) {
                    Text("Could not load the work log: $detailError", color = MaterialTheme.colorScheme.error)
                    TextButton(enabled = !busy && !detailLoading, onClick = { selectedId?.let { id -> scope.launch { loadDetail(id) } } }) { Text("Retry work log") }
                } else Text(if (detailLoading) "Loading this task's work log…" else "Work log is not available yet.", style = MaterialTheme.typography.bodyMedium)
            }
            if (task != null && task["id"]?.toString() == selectedId) {
                HorizontalDivider()
                Text("${task["status"]} · ${wakeLabel(task["nextWakeAt"])}")
                val id = task["id"].toString()
                val revision = (task["revision"] as? Number)?.toLong() ?: -1L
                val terminal = task["status"] in setOf("COMPLETED", "CANCELLED", "FAILED")
                var confirm by remember(id) { mutableStateOf<String?>(null) }
                val editing = quickEditId == id
                var editInstruction by remember(id) { mutableStateOf("") }
                var editGoal by remember(id) { mutableStateOf(task["goal"]?.toString().orEmpty()) }
                var editCriteria by remember(id) { mutableStateOf(task["successCriteria"]?.toString()?.takeIf { it != task["goal"]?.toString() }.orEmpty()) }
                if (!terminal) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    androidx.compose.material3.Switch(checked = task["continuous"] == true, enabled = !busy && connected, onCheckedChange = { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "continuous" to it)) })
                    Spacer(Modifier.width(8.dp))
                    Text("Continue useful steps in short passes", style = MaterialTheme.typography.bodyMedium)
                }
                if (!terminal && task["mode"] == "ONGOING") Text("After the plan is complete, monitoring follows its normal schedule.", style = MaterialTheme.typography.bodySmall)
                if (editing) {
                    OutlinedTextField(editGoal, { if (it.length <= 12_000) editGoal = it }, label = { Text("Goal") }, minLines = 2, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    OutlinedTextField(editCriteria, { if (it.length <= 10_000) editCriteria = it }, label = { Text("What does done look like? (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    OutlinedTextField(editInstruction, { if (it.length <= 10_000) editInstruction = it }, label = { Text("Tell Nethra what to change (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Text("Saved context is kept. Say continue or redo to restart stopped work; wording corrections keep it stopped.", style = MaterialTheme.typography.bodySmall)
                    Button(enabled = !busy && connected && editGoal.isNotBlank(), onClick = { perform("nethra.edit", mapOf("id" to id, "revision" to revision, "goal" to editGoal.trim(), "successCriteria" to editCriteria.trim(), "instruction" to editInstruction.trim())) }) { Text("Save changes") }
                }
                confirm?.let { action ->
                    androidx.compose.material3.AlertDialog(
                        onDismissRequest = { confirm = null },
                        title = { Text(if (action == "delete") "Delete this task?" else "Stop this task?") },
                        text = { Text(if (action == "delete") "Its history and drafts are removed from the PC. Its chat is kept as an ordinary conversation. This cannot be undone." else "It will not run again. Its chat, evidence and drafts are kept.") },
                        confirmButton = { TextButton(onClick = {
                            confirm = null
                            if (action == "delete") { perform("nethra.delete", mapOf("id" to id, "confirm" to true)) }
                            else perform("nethra.control", mapOf("id" to id, "action" to "cancel", "revision" to revision))
                        }) { Text(if (action == "delete") "Delete" else "Stop task") } },
                        dismissButton = { TextButton(onClick = { confirm = null }) { Text("Keep it") } }
                    )
                }
                TaskTracking(detail?.get("progress") as? Map<*, *>, null, task["mode"]?.toString())
                if (task["parentId"] == null) {
                    var showAgents by rememberSaveable(id) { mutableStateOf(false) }
                    var agentAssignment by rememberSaveable(id) { mutableStateOf("") }
                    val agents = maps(detail?.get("agents"))
                    Text("Task agents", style = MaterialTheme.typography.titleMedium)
                    if (detail != null && agents.isEmpty()) Text("No agents assigned to this task.")
                    agents.forEach { agent ->
                        val agentStatus = ObjectiveStatus.of(if (connected) agent else agent.filterKeys { it != "live" })
                        Text("${agent["goal"]} · ${agentStatus.label}")
                        if (agent["status"] == "SLEEPING" && agent["nextWakeAt"] is Number) Text(wakeLabel(agent["nextWakeAt"]))
                        if (connected && agent["live"] == true) (agent["tracking"] as? Map<*, *>)?.get("doing")?.toString()?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        TextButton(onClick = { selectedId = agent["id"]?.toString() }) { Text("View agent task") }
                    }
                    TextButton(onClick = { showAgents = !showAgents }) { Text(if (showAgents) "Hide assignment form" else "Assign an agent") }
                    if (showAgents) {
                        Text("Full agents run as separate tasks with their own permissions.")
                        OutlinedTextField(agentAssignment, { if (it.length <= 2000) agentAssignment = it }, label = { Text("Agent assignment") }, modifier = Modifier.fillMaxWidth())
                        Button(enabled = connected && !busy && settings["taskAgentsEnabled"] != false && detail?.containsKey("agents") == true && agentAssignment.isNotBlank(), onClick = {
                            perform("nethra.agent.create", mapOf("id" to id, "goal" to agentAssignment.trim()))
                        }) { Text("Launch task agent") }
                    }
                }
                val children = maps(detail?.get("children"))
                if (children.isNotEmpty()) {
                    Text("Research helpers", style = MaterialTheme.typography.titleSmall)
                    children.forEach { child ->
                        Text("${child["status"]?.toString()?.lowercase()?.replaceFirstChar { it.uppercase() }} · ${child["scope"]}")
                        if (child["status"] == "ACTIVE") {
                            OutlinedButton(enabled = connected && !busy, onClick = {
                                perform("nethra.child.stop", mapOf("id" to id, "childId" to child["id"]))
                            }) { Text("Stop helper") }
                        }
                        child["report"]?.toString()?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        child["error"]?.toString()?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                }
                task["summary"]?.toString()?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                if (!terminal) Row {
                    if (task["status"] == "SLEEPING") TextButton(enabled = !busy && connected, onClick = { perform("nethra.control", mapOf("id" to id, "revision" to revision, "action" to "wake")) }) { Text("Check now") }
                    TextButton(enabled = !busy && connected, onClick = { confirm = "stop" }) { Text("Stop task") }
                }
                val approvals = maps(detail?.get("approvals"))
                val moreApprovals = (detail?.get("moreApprovals") as? Number)?.toInt() ?: 0
                if (moreApprovals > 0) Text("$moreApprovals more approval request(s) will appear after this one is decided.")
                approvals.forEach { approval ->
                    Text("Approval · ${approval["tool"] ?: approval["action"] ?: "Action"} · ${approval["status"]}", style = MaterialTheme.typography.titleSmall)
                    SelectionContainer { Text(readable(approval["args"] ?: approval["payload"] ?: approval)) }
                    if (approval["reviewOnWindows"] == true) Text("This action is too large to review here. Review and approve it on Windows, or reject it here.")
                    if (approval["status"] == "PENDING") Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = !busy && connected && approval["reviewOnWindows"] != true, onClick = { perform("nethra.approve", mapOf("id" to approval["id"], "approved" to true)) }) { Text("Approve exact action") }
                        OutlinedButton(enabled = !busy && connected, onClick = { perform("nethra.approve", mapOf("id" to approval["id"], "approved" to false)) }) { Text("Reject") }
                    }
                }
                if (detail?.get("approvalUnavailable") == true) Text("This approval is no longer pending. Reopen the task from Tasks to see its current requests.")
                if (detail?.get("approvalUnavailable") != true && task["status"] == "WAITING_FOR_USER" && approvals.none { it["status"] == "PENDING" }) {
                    OutlinedTextField(answer, { if (it.length <= 10_000) answer = it }, label = { Text("Your answer") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Button(enabled = !busy && answer.isNotBlank() && connected, onClick = { perform("nethra.answer", mapOf("id" to id, "answer" to answer.trim(), "revision" to revision)) }) { Text("Send answer") }
                }
                var showApproach by rememberSaveable(id) { mutableStateOf(false) }
                TextButton(onClick = { showApproach = !showApproach }) { Text(if (showApproach) "Hide approach" else "Approach and settings") }
                if (showApproach) {
                PolicyChoice("Task model", task["model"]?.toString() ?: "qwen3:30b", taskModels, !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "model" to it)) }
                PolicyChoice("Objective type", task["mode"]?.toString() ?: "FINITE", listOf("FINITE" to "Finish when achieved", "ONGOING" to "Keep monitoring after each result"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "mode" to it)) }
                PolicyChoice("Autonomy", task["autonomy"]?.toString() ?: "BALANCED", listOf("QUIET" to "Quiet monitoring", "BALANCED" to "Balanced initiative", "ACTIVE" to "Active exploration"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "autonomy" to it)) }
                PolicyChoice("Priority", task["priority"]?.toString() ?: "3", (1..5).map { it.toString() to "$it · Priority" }, !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "priority" to it.toInt())) }
                PolicyChoice("Direction check-in", task["checkIn"]?.toString() ?: "WEEKLY", listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MILESTONES" to "At milestones or blockers", "MANUAL" to "Manual only"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "checkIn" to it)) }
                }
                TextButton(onClick = { showHistory = !showHistory }) { Text(if (showHistory) "Hide diagnostics" else "Diagnostics") }
                if (showHistory) {
                    NethraValues("Plan", task["plan"])
                    NethraValues("Completed steps", task["completedSteps"])
                    NethraValues("Pending steps", task["pendingSteps"])
                    NethraValues("Evidence and output receipts", task["evidence"])
                    NethraValues("Attention", detail?.get("attention"))
                    NethraValues("Errors", task["errors"])
                    TaskDiagnostics(detail?.get("progress") as? Map<*, *>, detail?.get("performance") as? Map<*, *>)
                    (if (diagnosticEvents.isEmpty()) maps(detail?.get("events")) else diagnosticEvents).forEach { event ->
                        Text("${dateLabel(event["at"])} · ${event["kind"]}", style = MaterialTheme.typography.labelMedium)
                        SelectionContainer { Text(readable(event["detail"])) }
                    }
                    if (diagnosticCursor != null) TextButton(enabled = connected && !diagnosticsLoading, onClick = {
                        val cursor = diagnosticCursor ?: return@TextButton
                        scope.launch {
                            diagnosticsLoading = true
                            try {
                                val page = request("nethra.get", mapOf("id" to id, "diagnosticsCursor" to cursor))
                                if (selectedId == id) {
                                    diagnosticEvents = diagnosticEvents + maps(page["events"])
                                    @Suppress("UNCHECKED_CAST")
                                    val next = page["nextCursor"] as? Map<String, Any?>
                                    diagnosticCursor = next
                                }
                            } catch (cancelled: CancellationException) { throw cancelled }
                            catch (failure: Exception) { error = failure.message ?: "Could not load diagnostics" }
                            finally { diagnosticsLoading = false }
                        }
                    }) { Text(if (diagnosticEvents.isEmpty()) "Load full history" else "Load more history") }
                }
            }
        }
    }
}

@Composable
private fun PolicyChoice(label: String, selected: String, options: List<Pair<String, String>>, enabled: Boolean, onSelect: (String) -> Unit) {
    var expanded by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelMedium)
        OutlinedButton(onClick = { expanded = true }, enabled = enabled) {
            Text(options.firstOrNull { it.first == selected }?.second ?: selected)
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            options.forEach { (value, title) ->
                DropdownMenuItem(text = { Text(title) }, onClick = { expanded = false; if (value != selected) onSelect(value) })
            }
        }
    }
}

/** Host-recorded progress: what Nethra is doing, did last, does next, and needs from you. */
@Composable
private fun TaskTracking(progress: Map<*, *>?, performance: Map<*, *>?, mode: String?) {
    if (progress == null) return
    Text("Task progress", style = MaterialTheme.typography.titleSmall)
    val waiting = progress["waitingFor"] as? Map<*, *>
    val needs = waiting?.get("kind")?.toString()?.takeIf { it in setOf("approval", "input", "blocked", "owner_resume") }
    if (needs != null) Text("Needs you: ${waiting["detail"]}", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
    progress["doing"]?.toString()?.let { Text("Now: $it") }
    progress["next"]?.toString()?.let { Text("Next action: $it", style = MaterialTheme.typography.bodyMedium) }
    val counts = progress["counts"] as? Map<*, *>
    val done = ((counts?.get("done") as? Number)?.toInt() ?: 0).coerceAtLeast(0)
    val total = ((counts?.get("total") as? Number)?.toInt() ?: 0).coerceAtLeast(0)
    if (total > 0) {
        LinearProgressIndicator(progress = { (done.toFloat() / total).coerceIn(0f, 1f) }, modifier = Modifier.fillMaxWidth())
        Text("$done of $total steps ${if (mode == "ONGOING") "this cycle" else "done"}", style = MaterialTheme.typography.bodySmall)
    }
    (progress["lastAccomplished"] as? Map<*, *>)?.let { Text("Last recorded (${dateLabel(it["at"])}): ${it["line"]}", style = MaterialTheme.typography.bodySmall) }
    (progress["wake"] as? Map<*, *>)?.let { Text("Wakes ${dateLabel(it["at"])}: ${it["reason"]}", style = MaterialTheme.typography.bodySmall) }
    maps(progress["outputs"]).takeIf { it.isNotEmpty() }?.let { outputs -> Text("Outputs: " + outputs.joinToString { it["path"].toString().substringAfterLast('\\').substringAfterLast('/') }, style = MaterialTheme.typography.bodySmall) }
}

@Composable
private fun TaskDiagnostics(progress: Map<*, *>?, performance: Map<*, *>?) {
    Text("Work log · newest first", style = MaterialTheme.typography.titleSmall)
    val activity = maps(progress?.get("activity"))
    if (activity.isEmpty()) Text("No recorded actions yet.", style = MaterialTheme.typography.bodySmall)
    activity.take(14).forEach { item ->
        val actor = item["actor"]?.toString() ?: "Junction"
        val model = item["model"]?.toString()?.takeIf { it.isNotBlank() }
        Text("• ${item["line"]} · ${dateLabel(item["at"])} · $actor${model?.let { " ($it)" } ?: ""}", style = MaterialTheme.typography.bodySmall)
    }
    if (performance != null) {
        Text("Measured performance · last 7 days", style = MaterialTheme.typography.titleSmall)
        ObjectivePerformance.lines(performance).forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
        Text("Recorded timings are not a before-and-after speedup test.", style = MaterialTheme.typography.labelSmall)
    }
}

/** Drafts are local only while editing; the host response remains authoritative. */
@Composable
private fun NotificationPreferences(settings: Map<*, *>, thisDevice: String, enabled: Boolean, onSave: (Map<String, Any?>) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    var editQuiet by rememberSaveable { mutableStateOf(false) }
    val preferred = settings["notificationDeviceId"] == thisDevice
    val mode = settings["proactiveUpdates"]?.toString() ?: "ALL"
    val modes = listOf("ALL" to "All meaningful updates", "IMPORTANT" to "Important updates only", "OFF" to "Quiet mode")
    val quiet = settings["quietHours"] as? Map<*, *>
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            TextButton(onClick = { expanded = !expanded }) { Text(if (expanded) "Hide notification settings" else "Notification settings") }
            Text(modes.firstOrNull { it.first == mode }?.second ?: "All meaningful updates", style = MaterialTheme.typography.bodySmall)
            Text(if (preferred) "Preferred phone: this device" else if (settings["notificationDeviceId"] != null) "Preferred phone: another paired device" else "No notification phone selected", style = MaterialTheme.typography.bodySmall)
            if (expanded) {
                modes.forEach { (value, label) ->
                    FilterChip(selected = mode == value, enabled = enabled, onClick = { onSave(mapOf("proactiveUpdates" to value)) }, label = { Text(label) })
                }
                Text("All includes verified milestones. Important includes outcomes, blockers and requests for your input. Quiet mode pauses proactive messages; tasks keep running.", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(enabled = enabled, onClick = { onSave(mapOf("notificationDeviceId" to if (preferred) null else thisDevice)) }) {
                    Text(if (preferred) "Stop task notifications on this phone" else "Send task notifications to this phone")
                }
                Text(if (quiet?.get("enabled") == true) "Quiet hours: ${quiet["start"]} to ${quiet["end"]}" else "Quiet hours are off", style = MaterialTheme.typography.bodySmall)
                OutlinedButton(enabled = enabled, onClick = { editQuiet = true }) { Text("Edit quiet hours") }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    Text("Allow Nethra voice invitations", Modifier.weight(1f))
                    Switch(checked = settings["voiceInvitations"] == true, enabled = enabled,
                        onCheckedChange = { onSave(mapOf("voiceInvitations" to it)) })
                }
                Text("Shared with Windows. Quiet hours use the PC's local time. Background delivery may be delayed.", style = MaterialTheme.typography.bodySmall)
                if (!enabled) Text("Waiting for your PC before making changes.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    if (editQuiet) {
        var quietOn by rememberSaveable { mutableStateOf(quiet?.get("enabled") == true) }
        var start by rememberSaveable { mutableStateOf(quiet?.get("start")?.toString() ?: "22:00") }
        var end by rememberSaveable { mutableStateOf(quiet?.get("end")?.toString() ?: "07:00") }
        val clock = remember { Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]") }
        val valid = clock.matches(start) && clock.matches(end) && (!quietOn || start != end)
        AlertDialog(
            onDismissRequest = { editQuiet = false },
            title = { Text("Quiet hours") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Use 24-hour times in your PC's local time zone. The window can cross midnight.")
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Enable quiet hours", Modifier.weight(1f))
                        Switch(checked = quietOn, enabled = enabled, onCheckedChange = { quietOn = it })
                    }
                    OutlinedTextField(value = start, enabled = enabled, singleLine = true, onValueChange = { start = it.take(5) }, label = { Text("Start (HH:mm)") }, isError = !clock.matches(start))
                    OutlinedTextField(value = end, enabled = enabled, singleLine = true, onValueChange = { end = it.take(5) }, label = { Text("End (HH:mm)") }, isError = !clock.matches(end))
                    if (quietOn && start == end) Text("Choose different times, or turn quiet hours off.")
                }
            },
            confirmButton = { TextButton(enabled = enabled && valid, onClick = {
                onSave(mapOf("quietHours" to mapOf("enabled" to quietOn, "start" to start, "end" to end)))
                editQuiet = false
            }) { Text("Save quiet hours") } },
            dismissButton = { TextButton(onClick = { editQuiet = false }) { Text("Cancel") } }
        )
    }
}

private fun maps(value: Any?): List<Map<*, *>> = (value as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
private fun dateLabel(value: Any?): String = (value as? Number)?.toLong()?.let { DateFormat.getDateTimeInstance().format(Date(it)) } ?: "Not scheduled"
private fun wakeLabel(value: Any?): String = if (value is Number) "Next wake: ${dateLabel(value)}" else "No scheduled wake"
private fun readable(value: Any?): String = when (value) {
    is Map<*, *> -> JSONObject(value).toString(2)
    is List<*> -> JSONArray(value).toString(2)
    null -> ""
    else -> value.toString()
}
@Composable
private fun NethraValues(label: String, value: Any?) {
    val entries = value as? List<*> ?: return
    if (entries.isEmpty()) return
    Text(label, style = MaterialTheme.typography.titleSmall)
    entries.forEach { SelectionContainer { Text(readable(it)) } }
}
