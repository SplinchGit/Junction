package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.sync.lan.DeviceCommandSync
import com.splinch.junction.data.sync.lan.NethraClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.text.DateFormat
import java.util.Date

/** The phone controls durable objectives on its paired Windows host. */
@Composable
fun NethraPanel(modifier: Modifier = Modifier, initialGoal: String? = null, onInitialGoalConsumed: () -> Unit = {}) {
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
    LaunchedEffect(initialGoal) {
        if (!initialGoal.isNullOrBlank()) {
            goal = initialGoal
            onInitialGoalConsumed()
        }
    }
    LaunchedEffect(Unit) {
        ObjectiveStatusMonitor.restore(context)
        objectives = ObjectiveStatusMonitor.objectives.value
        lastSyncedAt = ObjectiveStatusMonitor.lastSyncedAt.value
    }

    suspend fun refresh(status: Boolean = false) {
        val response = client.request("nethra.list")
        objectives = maps(response["objectives"])
        ObjectiveStatusMonitor.publish(context, objectives)
        if (selectedId != null && objectives.firstOrNull { it["id"]?.toString() == selectedId }?.get("status") in setOf("COMPLETED", "CANCELLED", "FAILED")) selectedId = null
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
            delay(if (!refreshFailed && NethraClient.lastTransport == NethraClient.Transport.LAN) 60_000L else 180_000L)
        }
    }

    OutlinedCard(modifier.fillMaxWidth()) {
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
            HorizontalDivider()
            OutlinedTextField(goal, { if (it.length <= 12_000) goal = it }, label = { Text("What should Nethra achieve?") }, minLines = 2, modifier = Modifier.fillMaxWidth(), enabled = !busy)
            OutlinedTextField(criteria, { if (it.length <= 4000) criteria = it }, label = { Text("Success criteria (optional)") }, modifier = Modifier.fillMaxWidth(), enabled = !busy)
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
                perform("nethra.create", buildMap { put("goal", goal.trim()); put("persistent", persistent); put("mode", mode); put("autonomy", autonomy); put("priority", priority); put("checkIn", checkIn); listOfNotNull("calendar".takeIf { watchCalendar }, "gmail".takeIf { watchGmail }).takeIf { it.isNotEmpty() }?.let { put("sources", it) }; if (criteria.isNotBlank()) put("successCriteria", criteria.trim()) })
            }) { Text(if (busy) "Contacting PC…" else "Create objective") }
            // Open work first (running, then in progress), then the five most recently ended.
            val withStatus = objectives.map { it to ObjectiveStatus.of(it) }
            val open = withStatus.filterNot { it.second.ended }.sortedBy { it.second.light.ordinal }
            val ended = withStatus.filter { it.second.ended }.take(5)
            if (open.isEmpty()) Text("Nethra has no open tasks. Ask her in chat to look after something.")
            (open + ended).forEach { (objective, status) ->
                OutlinedButton(enabled = !busy, onClick = { selectedId = objective["id"]?.toString() }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            StatusDot(status.light)
                            Spacer(Modifier.width(8.dp))
                            Text(status.label, style = MaterialTheme.typography.labelLarge)
                        }
                        Text(objective["goal"]?.toString().orEmpty(), maxLines = 2)
                        if (objective["mode"] == "ONGOING") Text("Ongoing monitoring", style = MaterialTheme.typography.labelSmall)
                        ObjectiveStatus.stepLine(objective)?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
                        objective["summary"]?.toString()?.takeIf { it.isNotBlank() }?.let { Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 3) }
                    }
                }
            }
            val task = detail?.get("task") as? Map<*, *>
            if (task != null && task["id"]?.toString() == selectedId) {
                HorizontalDivider()
                Text(task["goal"]?.toString().orEmpty(), style = MaterialTheme.typography.titleMedium)
                Text("${task["status"]} · ${wakeLabel(task["nextWakeAt"])}")
                task["nextDirectionCheckAt"]?.let { Text("Direction review: ${dateLabel(it)}") }
                task["lastExecutionAt"]?.let { Text("Last run: ${dateLabel(it)}") }
                task["lastMeaningfulProgressAt"]?.let { Text("Last verified progress: ${dateLabel(it)}") }
                Text(task["summary"]?.toString().orEmpty())
                val id = task["id"].toString()
                val revision = (task["revision"] as? Number)?.toLong() ?: -1L
                val terminal = task["status"] in setOf("COMPLETED", "CANCELLED", "FAILED")
                PolicyChoice("Objective type", task["mode"]?.toString() ?: "FINITE", listOf("FINITE" to "Finish when achieved", "ONGOING" to "Keep monitoring after each result"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "mode" to it)) }
                PolicyChoice("Autonomy", task["autonomy"]?.toString() ?: "BALANCED", listOf("QUIET" to "Quiet monitoring", "BALANCED" to "Balanced initiative", "ACTIVE" to "Active exploration"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "autonomy" to it)) }
                PolicyChoice("Priority", task["priority"]?.toString() ?: "3", (1..5).map { it.toString() to "$it · Priority" }, !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "priority" to it.toInt())) }
                PolicyChoice("Direction check-in", task["checkIn"]?.toString() ?: "WEEKLY", listOf("DAILY" to "Daily", "WEEKLY" to "Weekly", "MILESTONES" to "At milestones or blockers", "MANUAL" to "Manual only"), !busy && connected && !terminal) { perform("nethra.configure", mapOf("id" to id, "revision" to revision, "checkIn" to it)) }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val resumable = task["status"] in setOf("PAUSED", "SLEEPING")
                    OutlinedButton(enabled = !busy && connected && !terminal, onClick = { perform("nethra.control", mapOf("id" to id, "action" to if (resumable) "resume" else "pause", "revision" to revision)) }) { Text(if (resumable) "Resume" else "Pause") }
                    OutlinedButton(enabled = !busy && connected && !terminal, onClick = { perform("nethra.control", mapOf("id" to id, "action" to "cancel", "revision" to revision)) }) { Text("Cancel") }
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
