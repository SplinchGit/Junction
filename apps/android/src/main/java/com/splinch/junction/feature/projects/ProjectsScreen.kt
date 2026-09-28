package com.splinch.junction.feature.projects

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.splinch.junction.data.sync.lan.ForemanClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.text.DateFormat
import java.util.Date

@Composable
fun ProjectsScreen(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val client = remember { ForemanClient(context) }
    val scope = rememberCoroutineScope()
    var projects by remember { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var selectedId by remember { mutableStateOf<String?>(null) }
    var project by remember { mutableStateOf<Map<*, *>?>(null) }
    var events by remember { mutableStateOf<List<Map<*, *>>>(emptyList()) }
    var connected by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    suspend fun refresh() {
        try {
            projects = (client.request("project.list")["projects"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
            selectedId?.let { id ->
                val response = client.request("project.get", mapOf("id" to id))
                project = response["project"] as? Map<*, *>
                events = (response["events"] as? List<*>)?.mapNotNull { it as? Map<*, *> }.orEmpty()
            }
            connected = true
        } catch (e: Exception) { connected = false; error = e.message ?: "Windows is unavailable" }
    }
    LaunchedEffect(selectedId) { while (true) { if (!busy) refresh(); delay(5000) } }
    fun perform(type: String, payload: Map<String, Any?>) {
        busy = true
        scope.launch {
            try { client.request(type, payload); error = "" } catch (e: Exception) { error = e.message ?: "Request failed" }
            finally { refresh(); busy = false }
        }
    }
    LazyColumn(modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Work Activity", style = MaterialTheme.typography.headlineMedium)
            Text(if (connected) "Connected to Junction Windows" else "Disconnected — controls unavailable")
            Text("Give Junction a development instruction in Chat. Name a file, folder or repository once; the conversation starts and keeps that work context. Stop remains available here while work is active.")
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { scope.launch { refresh() } }, enabled = !busy) { Text("Refresh") }
        }
        if (projects.isEmpty()) item { Text("No work yet. Ask Junction to work on a local path or named project in Chat.") }
        projects.forEach { p -> item {
            OutlinedButton(onClick = { selectedId = p["id"]?.toString(); project = null }, modifier = Modifier.fillMaxWidth()) {
                Text("${p["name"]} · ${p["status"]}")
            }
        } }
        project?.let { p ->
            val id = p["id"].toString()
            val revision = (p["revision"] as? Number)?.toLong() ?: -1L
            val status = p["status"].toString()
            val active = status in setOf("RUNNING", "WAITING_CODEX", "VERIFYING")
            item {
                Text(p["name"].toString(), style = MaterialTheme.typography.titleLarge)
                Text(p["repoPath"]?.toString().orEmpty())
                Text(p["objective"].toString())
                Text("$status · ${p["nextAction"]}")
                (p["retryAt"] as? Number)?.let { Text("Scheduled retry: ${DateFormat.getDateTimeInstance().format(Date(it.toLong()))}") }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val actions = if (active) listOf("stop") else emptyList()
                    actions.forEach { action -> Button(enabled = connected && !busy, onClick = { perform("task.control", mapOf("id" to id, "revision" to revision, "action" to action)) }) { Text(action.replaceFirstChar { it.uppercase() }) } }
                }
            }
            (p["tasks"] as? List<*>)?.mapNotNull { it as? Map<*, *> }?.forEach { task -> item {
                Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
                    Text(task["title"].toString(), style = MaterialTheme.typography.titleMedium)
                    Text("${if (task["kind"] == "verify") "Junction" else "Codex"} · ${task["status"]}")
                    Text(task["acceptance"].toString())
                    val attempt = task["lastAttempt"] as? Map<*, *>
                    attempt?.get("error")?.let { Text(it.toString(), color = MaterialTheme.colorScheme.error) }
                    attempt?.get("summary")?.let { Text(it.toString()) }
                    (attempt?.get("tests") as? List<*>)?.mapNotNull { it as? Map<*, *> }?.forEach { Text("Test exit ${it["exitCode"]}: ${it["command"]}") }
                } }
            } }
            item { Text("Handoff", style = MaterialTheme.typography.titleMedium); Text(p["handoff"].toString()) }
            if (!active) item { Text("Tell Junction to continue or give it the next instruction in Chat.") }
            item { Text("Activity log", style = MaterialTheme.typography.titleMedium) }
            events.forEach { e -> item { Text("${e["kind"]}: ${e["detail"]}") } }
        }
    }
}
