package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
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
fun NethraPanel(modifier: Modifier = Modifier, initialGoal: String? = null, initialTaskId: String? = null, conversationId: String? = null, onInitialGoalConsumed: () -> Unit = {}, onOpenChat: (String) -> Unit = {}) {
    val context = LocalContext.current
    val client = remember(context) { NethraClient(context) }
    val deviceSync = remember(context) { DeviceCommandSync(context) }
    var consents by remember { mutableStateOf(deviceSync.pendingConsents()) }
    val scope = rememberCoroutineScope()
    var goal by rememberSaveable { mutableStateOf("") }
    var criteria by rememberSaveable { mutableStateOf("") }
    var persistent by rememberSaveable { mutableStateOf(true) }
    var mode by rememberSaveable { mutableStateOf("FINITE") }
    var autonomy by rememberSaveable { mutableStateOf("BALANCED") }
    var priority by rememberSaveable { mutableIntStateOf(3) }
    var checkIn by rememberSaveable { mutableStateOf("WEEKLY") }
    var watchCalendar by rememberSaveable { mutableStateOf(false) }
    var watchGmail by rememberSaveable { mutableStateOf(false) }
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    val taskScroll = rememberScrollState()
    var objectives by remember { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var settings by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var hostStatus by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var reunion by remember { mutableStateOf<Map<*, *>>(emptyMap<String, Any?>()) }
    var detail by remember { mutableStateOf<Map<*, *>?>(null) }
    var busy by remember { mutableStateOf(false) }
    var connected by remember { mutableStateOf(false) }
    var lastSyncedAt by remember { mutableStateOf<Long?>(null) }
    var error by remember { mutableStateOf("") }
    var answer by rememberSaveable(selectedId) { mutableStateOf("") }
    var showHistory by rememberSaveable { mutableStateOf(false) }
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

    suspend fun refresh(status: Boolean = false) {
        val response = client.request("nethra.list")
        objectives = maps(response["objectives"])
        ObjectiveStatusMonitor.publish(context, objectives)
        settings = response["settings"] as? Map<*, *> ?: emptyMap<String, Any?>()
        selectedId?.let { detail = client.request("nethra.get", mapOf("id" to it)) }
        if (status) {
            hostStatus = client.request("nethra.status")
            reunion = client.request("nethra.reunion", mapOf("since" to System.currentTimeMillis() - 86_400_000L))
        }
        connected = true
        lastSyncedAt = System.currentTimeMillis()
    }
    fun perform(type: String, payload: Map<String, Any?>) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                val result = client.request(type, payload)
                if (type == "nethra.create") {
                    selectedId = (result["task"] as? Map<*, *>)?.get("id")?.toString()
                    goal = ""; criteria = ""
                }
                if (type == "nethra.answer") answer = ""
                error = ""
                refresh()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                error = failure.message ?: "The PC did not confirm the request. Refresh to check its saved state."
                // Refresh is read-only; retrying this same request keeps its identity.
                try { refresh() } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { connected = false; ObjectiveStatusMonitor.disconnected() }
            } finally { busy = false }
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
        detail = null
        while (true) {
            var refreshFailed = false
            if (!busy) {
                try { refresh(status = hostStatus.isEmpty()); error = "" }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (failure: Exception) { refreshFailed = true; connected = false; ObjectiveStatusMonitor.disconnected(); error = failure.message ?: "The paired Windows host is unavailable." }
            }
            delay(if (!refreshFailed && NethraClient.lastTransport == NethraClient.Transport.LAN) { if (selectedId != null) 3_000L else 60_000L } else 180_000L)
        }
    }

    OutlinedCard(modifier.fillMaxWidth().verticalScroll(taskScroll), shape = RoundedCornerShape(4.dp)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Objectives", style = MaterialTheme.typography.titleLarge)
            Text("Active commitments and decisions from your paired PC.")
            Text(if (connected) "Connected to your Windows host" else if (lastSyncedAt != null) "Offline · last synced ${dateLabel(lastSyncedAt)}. This view may be stale." else "Offline · connect to your Windows host to load objectives.")
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedButton(enabled = !busy, onClick = {
                scope.launch {
                    busy = true
                    try { refresh(status = true); error = "" }
                    catch (cancelled: CancellationException) { throw cancelled }
                    catch (failure: Exception) { connected = false; ObjectiveStatusMonitor.disconnected(); error = failure.message ?: "Refresh failed" }
                    finally { busy = false }
                }
            }) { Text("Refresh objectives") }
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
            OutlinedTextField(criteria, { if (it.length <= 4000) criteria = it }, label = { Text("Success criteria (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
            Row {
                Checkbox(checked = continuousNew, onCheckedChange = { continuousNew = it }, enabled = !busy)
                Text("Keep working continuously until done", Modifier.padding(top = 12.dp))
            }
            Row {
                Checkbox(checked = persistent, onCheckedChange = { persistent = it }, enabled = !busy)
                Text("Keep this objective active between runs", Modifier.padding(top = 12.dp))
            }
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
                perform("nethra.create", buildMap { put("goal", goal.trim()); conversationId?.let { put("conversationId", it) }; put("persistent", persistent); put("continuous", continuousNew); put("mode", mode); put("autonomy", autonomy); put("priority", priority); put("checkIn", checkIn); listOfNotNull("calendar".takeIf { watchCalendar }, "gmail".takeIf { watchGmail }).takeIf { it.isNotEmpty() }?.let { put("sources", it) }; if (criteria.isNotBlank()) put("successCriteria", criteria.trim()) })
            }) { Text(if (busy) "Contacting PC…" else "Create objective") }
            }
            // Open work first (running, then in progress), then the five most recently ended.
            val withStatus = objectives.map { it to ObjectiveStatus.of(it) }
            val open = withStatus.filterNot { it.second.ended }.sortedBy { it.second.light.ordinal }
            val ended = withStatus.filter { it.second.ended }.take(5)
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
                            Text(status.label, style = MaterialTheme.typography.labelLarge)
                        }
                        Text(objective["goal"]?.toString().orEmpty(), style = MaterialTheme.typography.titleSmall, maxLines = 2)
                        val tracking = objective["tracking"] as? Map<*, *>
                        tracking?.get("doing")?.toString()?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 2) }
                        ObjectiveStatus.stepLine(objective)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        if (!status.ended) Text(if (objective["continuous"] == true) "Continuous passes on" else "Continuous passes off", style = MaterialTheme.typography.labelSmall)
                    }
                }
            } else TextButton(onClick = { selectedId = null; detail = null }) { Text("← All tasks") }
            val task = detail?.get("task") as? Map<*, *>
            if (selectedId != null && task == null) Text("Loading this task's work log…", style = MaterialTheme.typography.bodyMedium)
            if (task != null && task["id"]?.toString() == selectedId) {
                HorizontalDivider()
                Text(task["goal"]?.toString().orEmpty(), style = MaterialTheme.typography.titleMedium)
                OutlinedButton(enabled = !busy && connected, onClick = {
                    val id = task["id"]?.toString() ?: return@OutlinedButton
                    scope.launch {
                        busy = true
                        try {
                            val result = client.request("nethra.openChat", mapOf("id" to id))
                            val taskConversationId = result["conversationId"]?.toString() ?: error("PC did not return a chat")
                            val app = context.applicationContext as JunctionApplication
                            if (app.container.database.chatDao().getSessionById(taskConversationId) == null) app.container.pairedConversationSyncManager.syncNow()
                            check(app.container.database.chatDao().getSessionById(taskConversationId) != null) { "Task chat is not synced yet. Try again after conversation sync completes." }
                            onOpenChat(taskConversationId)
                        } catch (cancelled: CancellationException) { throw cancelled }
                        catch (failure: Exception) { error = failure.message ?: "Could not open the task chat" }
                        finally { busy = false }
                    }
                }) { Text("Open task chat") }
                Text("${task["status"]} · ${wakeLabel(task["nextWakeAt"])}")
                task["nextDirectionCheckAt"]?.let { Text("Direction review: ${dateLabel(it)}") }
                task["lastExecutionAt"]?.let { Text("Last run: ${dateLabel(it)}") }
                task["lastMeaningfulProgressAt"]?.let { Text("Last verified progress: ${dateLabel(it)}") }
                TaskTracking(detail?.get("progress") as? Map<*, *>, detail?.get("performance") as? Map<*, *>, task["mode"]?.toString())
                task["summary"]?.toString()?.takeIf { it.isNotBlank() }?.let { Text("Nethra's note: $it", style = MaterialTheme.typography.bodySmall) }
                val id = task["id"].toString()
                val revision = (task["revision"] as? Number)?.toLong() ?: -1L
                val terminal = task["status"] in setOf("COMPLETED", "CANCELLED", "FAILED")
                PolicyChoice("Objective type", task["mode"]?.toString() ?: "FINITE", listOf("FINITE" to "Finish when achieved", "ONGOING" to "Keep monitoring after each result"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "mode" to it)) }
                PolicyChoice("Autonomy", task["autonomy"]?.toString() ?: "BALANCED", listOf("QUIET" to "Quiet monitoring", "BALANCED" to "Balanced initiative", "ACTIVE" to "Active exploration"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "autonomy" to it)) }
                PolicyChoice("Priority", task["priority"]?.toString() ?: "3", (1..5).map { it.toString() to "$it · Priority" }, !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "priority" to it.toInt())) }
                PolicyChoice("Direction check-in", task["checkIn"]?.toString() ?: "WEEKLY", listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MILESTONES" to "At milestones or blockers", "MANUAL" to "Manual only"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "checkIn" to it)) }
                var confirm by remember(id) { mutableStateOf<String?>(null) }
                var editing by remember(id) { mutableStateOf(false) }
                var editGoal by remember(id) { mutableStateOf(task["goal"]?.toString().orEmpty()) }
                var editCriteria by remember(id) { mutableStateOf(task["successCriteria"]?.toString()?.takeIf { it != task["goal"]?.toString() }.orEmpty()) }
                @OptIn(androidx.compose.foundation.layout.ExperimentalLayoutApi::class)
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val status = task["status"]?.toString()
                    if (!terminal) {
                        if (status == "PAUSED") OutlinedButton(enabled = !busy && connected, onClick = { perform("nethra.control", mapOf("id" to id, "action" to "resume", "revision" to revision)) }) { Text("Resume") }
                        else if (status !in setOf("WAITING_FOR_USER", "BLOCKED")) OutlinedButton(enabled = !busy && connected, onClick = { perform("nethra.control", mapOf("id" to id, "action" to "pause", "revision" to revision)) }) { Text("Pause") }
                        if (status == "SLEEPING") OutlinedButton(enabled = !busy && connected, onClick = { perform("nethra.control", mapOf("id" to id, "action" to "wake", "revision" to revision)) }) { Text("Check now") }
                        OutlinedButton(enabled = !busy && connected, onClick = { editing = !editing }) { Text("Edit") }
                        OutlinedButton(enabled = !busy && connected, onClick = { confirm = "stop" }) { Text("Stop task") }
                    }
                    OutlinedButton(enabled = !busy && connected, onClick = { confirm = "delete" }) { Text("Delete") }
                }
                if (!terminal) Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    androidx.compose.material3.Switch(checked = task["continuous"] == true, enabled = !busy && connected, onCheckedChange = { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "continuous" to it)) })
                    Spacer(Modifier.width(8.dp))
                    Text("Continue useful steps in short passes", style = MaterialTheme.typography.bodyMedium)
                }
                if (!terminal && task["mode"] == "ONGOING") Text("After the plan is complete, monitoring follows its normal schedule.", style = MaterialTheme.typography.bodySmall)
                if (editing && !terminal) {
                    OutlinedTextField(editGoal, { if (it.length <= 12_000) editGoal = it }, label = { Text("Goal") }, minLines = 2, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    OutlinedTextField(editCriteria, { if (it.length <= 4000) editCriteria = it }, label = { Text("What does done look like? (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Text("Completed steps and evidence are kept; Nethra re-plans from the new wording.", style = MaterialTheme.typography.bodySmall)
                    Button(enabled = !busy && connected && editGoal.isNotBlank(), onClick = { editing = false; perform("nethra.edit", mapOf("id" to id, "revision" to revision, "goal" to editGoal.trim(), "successCriteria" to editCriteria.trim())) }) { Text("Save changes") }
                }
                confirm?.let { action ->
                    androidx.compose.material3.AlertDialog(
                        onDismissRequest = { confirm = null },
                        title = { Text(if (action == "delete") "Delete this task?" else "Stop this task?") },
                        text = { Text(if (action == "delete") "Its history and drafts are removed from the PC. Its chat is kept as an ordinary conversation. This cannot be undone." else "It will not run again. Its chat, evidence and drafts are kept.") },
                        confirmButton = { TextButton(onClick = {
                            confirm = null
                            if (action == "delete") { perform("nethra.delete", mapOf("id" to id, "confirm" to true)); selectedId = null }
                            else perform("nethra.control", mapOf("id" to id, "action" to "cancel", "revision" to revision))
                        }) { Text(if (action == "delete") "Delete" else "Stop task") } },
                        dismissButton = { TextButton(onClick = { confirm = null }) { Text("Keep it") } }
                    )
                }
                NethraValues("Plan", task["plan"])
                NethraValues("Completed steps", task["completedSteps"])
                NethraValues("Pending steps", task["pendingSteps"])
                NethraValues("Evidence", task["evidence"])
                NethraValues("Attention", detail?.get("attention"))
                NethraValues("Errors", task["errors"])
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
                if (task["status"] == "WAITING_FOR_USER" && approvals.none { it["status"] == "PENDING" }) {
                    OutlinedTextField(answer, { if (it.length <= 4000) answer = it }, label = { Text("Your answer") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
                    Button(enabled = !busy && answer.isNotBlank() && connected, onClick = { perform("nethra.answer", mapOf("id" to id, "answer" to answer.trim(), "revision" to revision)) }) { Text("Send answer") }
                }
                TextButton(onClick = { showHistory = !showHistory }) { Text(if (showHistory) "Hide history" else "Show history") }
                if (showHistory) maps(detail?.get("events")).takeLast(30).forEach { event ->
                    Text("${dateLabel(event["at"])} · ${event["kind"]}", style = MaterialTheme.typography.labelMedium)
                    SelectionContainer { Text(readable(event["detail"])) }
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
    Text("Work log · newest first", style = MaterialTheme.typography.titleSmall)
    val activity = maps(progress["activity"])
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
