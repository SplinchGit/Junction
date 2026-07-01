1| ﻿package com.splinch.junction.ui
2| 
3| import android.content.Intent
4| import android.provider.Settings
5| import android.widget.Toast
6| import androidx.compose.foundation.layout.Arrangement
7| import androidx.compose.foundation.layout.Column
8| import androidx.compose.foundation.layout.Row
9| import androidx.compose.foundation.layout.fillMaxSize
10| import androidx.compose.foundation.layout.fillMaxWidth
11| import androidx.compose.foundation.layout.padding
12| import androidx.compose.foundation.lazy.LazyColumn
13| import androidx.compose.foundation.lazy.items
14| import androidx.compose.material3.Button
15| import androidx.compose.material3.ExperimentalMaterial3Api
16| import androidx.compose.material3.OutlinedButton
17| import androidx.compose.material3.MaterialTheme
18| import androidx.compose.material3.ModalBottomSheet
19| import androidx.compose.material3.OutlinedTextField
20| import androidx.compose.material3.Switch
21| import androidx.compose.material3.Text
22| import androidx.compose.material3.TextButton
23| import androidx.compose.runtime.Composable
24| import androidx.compose.runtime.LaunchedEffect
25| import androidx.compose.runtime.collectAsState
26| import androidx.compose.runtime.getValue
27| import androidx.compose.runtime.mutableIntStateOf
28| import androidx.compose.runtime.mutableStateMapOf
29| import androidx.compose.runtime.mutableStateOf
30| import androidx.compose.runtime.remember
31| import androidx.compose.runtime.rememberCoroutineScope
32| import androidx.compose.runtime.setValue
33| import androidx.compose.ui.Alignment
34| import androidx.compose.ui.Modifier
35| import androidx.compose.ui.platform.LocalContext
36| import androidx.compose.ui.text.font.FontWeight
37| import androidx.compose.ui.unit.dp
38| import androidx.core.net.toUri
39| import com.splinch.junction.BuildConfig
40| import com.splinch.junction.core.Config
41| import com.splinch.junction.employment.EmploymentRepository
42| import com.splinch.junction.employment.EmploymentState
43| import com.splinch.junction.employment.EmploymentStatusSnapshot
44| import com.splinch.junction.employment.EmploymentType
45| import com.splinch.junction.feed.FeedRepository
46| import com.splinch.junction.follow.FollowRepository
47| import com.splinch.junction.follow.FollowTargetEntity
48| import com.splinch.junction.follow.FollowTargetType
49| import com.splinch.junction.follow.SourceApp
50| import com.splinch.junction.scheduler.Scheduler
51| import com.splinch.junction.settings.UserPrefsRepository
52| import com.splinch.junction.sync.firebase.AuthManager
53| import kotlinx.coroutines.Dispatchers
54| import kotlinx.coroutines.launch
55| import kotlinx.coroutines.tasks.await
56| import kotlinx.coroutines.withContext
57| import okhttp3.MediaType.Companion.toMediaType
58| import okhttp3.OkHttpClient
59| import okhttp3.Request
60| import okhttp3.RequestBody.Companion.toRequestBody
61| import org.json.JSONObject
62| import java.time.Duration
63| import java.time.Instant
64| import java.time.LocalDate
65| import java.time.ZoneId
66| import java.time.format.DateTimeFormatter
67| 
68| @Composable
69| @OptIn(ExperimentalMaterial3Api::class)
70| fun SettingsScreen(
71|     userPrefs: UserPrefsRepository,
72|     feedRepository: FeedRepository,
73|     followRepository: FollowRepository,
74|     employmentRepository: EmploymentRepository,
75|     authManager: AuthManager,
76|     modifier: Modifier = Modifier
77| ) {
78|     val scope = rememberCoroutineScope()
79|     val context = LocalContext.current
80|     val activity = context as? android.app.Activity
81| 
82|     val useBackend by userPrefs.useHttpBackendFlow.collectAsState(initial = false)
83|     val apiBaseUrl by userPrefs.apiBaseUrlFlow.collectAsState(initial = "")
84|     val chatModel by userPrefs.chatModelFlow.collectAsState(initial = Config.buildChatModel)
85|     val chatApiKey by userPrefs.chatApiKeyFlow.collectAsState(initial = "")
86|     val digestInterval by userPrefs.digestIntervalMinutesFlow.collectAsState(initial = 30)
87|     val realtimeEndpoint by userPrefs.realtimeEndpointFlow.collectAsState(initial = "")
88|     val realtimeClientSecretEndpoint by userPrefs.realtimeClientSecretEndpointFlow.collectAsState(initial = "")
89|     val webClientIdOverride by userPrefs.webClientIdOverrideFlow.collectAsState(initial = "")
90|     val notificationAck by userPrefs.notificationAccessAcknowledgedFlow.collectAsState(initial = false)
91|     val listenerEnabled by userPrefs.notificationListenerEnabledFlow.collectAsState(initial = false)
92|     val junctionOnlyNotifications by userPrefs.junctionOnlyNotificationsFlow.collectAsState(initial = false)
93|     val disabledPackages by userPrefs.disabledPackagesFlow.collectAsState(initial = emptySet())
94|     val connectedIntegrations by userPrefs.connectedIntegrationsFlow.collectAsState(initial = emptySet())
95|     val mafiosoEnabled by userPrefs.mafiosoGameEnabledFlow.collectAsState(initial = false)
96|     val copilotEnabled by userPrefs.copilotEnabledFlow.collectAsState(initial = false)
97|     val user by authManager.userFlow.collectAsState()
98|     val followTargets by followRepository.followTargetsFlow().collectAsState(initial = emptyList())
99|     val employmentSnapshot by employmentRepository.statusSnapshotFlow()
100|         .collectAsState(initial = EmploymentStatusSnapshot(null, null))
101|     val defaultWebClientIdRes = remember {
102|         context.resources.getIdentifier("default_web_client_id", "string", context.packageName)
103|     }
104|     val defaultWebClientIdValue = remember(defaultWebClientIdRes) {
105|         if (defaultWebClientIdRes != 0) context.getString(defaultWebClientIdRes) else ""
106|     }
107|     val overrideWebClientId = Config.sanitizeWebClientId(webClientIdOverride)
108|     val buildWebClientId = Config.buildWebClientId
109|     val resourceWebClientId = Config.sanitizeWebClientId(defaultWebClientIdValue)
110|     val effectiveWebClientId = listOf(
111|         overrideWebClientId,
112|         buildWebClientId,
113|         resourceWebClientId
114|     ).firstOrNull { it.isNotBlank() }.orEmpty()
115|     val webClientIdSource = when {
116|         overrideWebClientId.isNotBlank() -> "Override"
117|         buildWebClientId.isNotBlank() -> "BuildConfig"
118|         resourceWebClientId.isNotBlank() -> "google-services"
119|         else -> "Missing"
120|     }
121|     val webClientIdLooksValid = effectiveWebClientId.isNotBlank() &&
122|         Config.looksLikeWebClientId(effectiveWebClientId)
123| 
124|     var apiBaseUrlInput by remember { mutableStateOf(apiBaseUrl) }
125|     var chatModelInput by remember { mutableStateOf(chatModel) }
126|     var chatApiKeyInput by remember { mutableStateOf(chatApiKey) }
127|     var intervalInput by remember { mutableStateOf(digestInterval.toString()) }
128|     var realtimeEndpointInput by remember { mutableStateOf(realtimeEndpoint) }
129|     var realtimeClientSecretInput by remember { mutableStateOf(realtimeClientSecretEndpoint) }
130|     var webClientIdOverrideInput by remember { mutableStateOf(webClientIdOverride) }
131|     var understandChecked by remember { mutableStateOf(false) }
132|     var packages by remember { mutableStateOf(emptyList<String>()) }
133|     var authError by remember { mutableStateOf<String?>(null) }
134|     val httpClient = remember { OkHttpClient() }
135|     var clientSecretStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
136|     var backendStatus by remember { mutableStateOf(ConnectionState(ConnectionStatus.IDLE)) }
137|     var showAdvancedBackend by remember { mutableStateOf(false) }
138| 
139|     var showAddFollowTarget by remember { mutableStateOf(false) }
140|     var showEmploymentStatusSheet by remember { mutableStateOf(false) }
141|     var showAddRoleSheet by remember { mutableStateOf(false) }
142|     var followWizardStep by remember { mutableIntStateOf(0) }
143|     var creatorNameInput by remember { mutableStateOf("") }
144|     var selectedPlatforms by remember { mutableStateOf(setOf<SourceApp>()) }
145|     val platformHandles = remember { mutableStateMapOf<SourceApp, String>() }
146|     var selectedEmploymentState by remember { mutableStateOf(EmploymentState.UNEMPLOYED) }
147|     var employmentNotes by remember { mutableStateOf("") }
148|     var roleTitleInput by remember { mutableStateOf("") }
149|     var roleEmployerInput by remember { mutableStateOf("") }
150|     var roleTypeInput by remember { mutableStateOf(EmploymentType.FULL_TIME) }
151|     var roleStartDateInput by remember { mutableStateOf("") }
152|     var rolePayInput by remember { mutableStateOf("") }
153|     var roleSourceInput by remember { mutableStateOf("") }
154|     val integrations = remember(connectedIntegrations) {
155|         listOf(
156|             IntegrationItem(
157|                 id = "google",
158|                 name = "Google Calendar",
159|                 description = "Upcoming events, reminders, and daily agenda.",
160|                 status = if (connectedIntegrations.contains("google")) "Connected" else "Ready to connect",
161|                 enabled = !connectedIntegrations.contains("google"),
162|                 connected = connectedIntegrations.contains("google")
163|             ),
164|             IntegrationItem(
165|                 id = "slack",
166|                 name = "Slack",
167|                 description = "Mentions, DMs, and priority channels.",
168|                 status = if (connectedIntegrations.contains("slack")) "Connected" else "Ready to connect",
169|                 enabled = !connectedIntegrations.contains("slack"),
170|                 connected = connectedIntegrations.contains("slack")
171|             ),
172|             IntegrationItem(
173|                 id = "github",
174|                 name = "GitHub",
175|                 description = "PRs, issues, and review requests.",
176|                 status = if (connectedIntegrations.contains("github")) "Connected" else "Ready to connect",
177|                 enabled = !connectedIntegrations.contains("github"),
178|                 connected = connectedIntegrations.contains("github")
179|             ),
180|             IntegrationItem(
181|                 id = "notion",
182|                 name = "Notion",
183|                 description = "Tasks and knowledge updates.",
184|                 status = if (connectedIntegrations.contains("notion")) "Connected" else "Ready to connect",
185|                 enabled = !connectedIntegrations.contains("notion"),
186|                 connected = connectedIntegrations.contains("notion")
187|             )
188|         )
189|     }
190| 
191|     LaunchedEffect(apiBaseUrl) {
192|         apiBaseUrlInput = apiBaseUrl
193|     }
194| 
195|     LaunchedEffect(chatModel) {
196|         chatModelInput = chatModel
197|     }
198| 
199|     LaunchedEffect(chatApiKey) {
200|         chatApiKeyInput = chatApiKey
201|     }
202| 
203|     LaunchedEffect(digestInterval) {
204|         intervalInput = digestInterval.toString()
205|     }
206| 
207|     LaunchedEffect(realtimeEndpoint) {
208|         realtimeEndpointInput = realtimeEndpoint
209|     }
210| 
211|     LaunchedEffect(realtimeClientSecretEndpoint) {
212|         realtimeClientSecretInput = realtimeClientSecretEndpoint
213|     }
214| 
215|     LaunchedEffect(webClientIdOverride) {
216|         webClientIdOverrideInput = webClientIdOverride
217|     }
218| 
219|     LaunchedEffect(Unit) {
220|         packages = feedRepository.getDistinctPackages()
221|     }
222| 
223|     LaunchedEffect(showEmploymentStatusSheet, employmentSnapshot.status) {
224|         if (showEmploymentStatusSheet) {
225|             val status = employmentSnapshot.status
226|             selectedEmploymentState = status?.state ?: EmploymentState.UNEMPLOYED
227|             employmentNotes = status?.notes.orEmpty()
228|         }
229|     }
230| 
231|     LaunchedEffect(showAddRoleSheet) {
232|         if (showAddRoleSheet) {
233|             roleTitleInput = ""
234|             roleEmployerInput = ""
235|             roleTypeInput = EmploymentType.FULL_TIME
236|             roleStartDateInput = ""
237|             rolePayInput = ""
238|             roleSourceInput = ""
239|         }
240|     }
241| 
242|     LaunchedEffect(showAddFollowTarget) {
243|         if (showAddFollowTarget) {
244|             followWizardStep = 0
245|             creatorNameInput = ""
246|             selectedPlatforms = emptySet()
247|             platformHandles.clear()
248|         }
249|     }
250| 
251|     LazyColumn(
252|         modifier = modifier
253|             .fillMaxSize()
254|             .padding(16.dp),
255|         verticalArrangement = Arrangement.spacedBy(20.dp)
256|     ) {
257|         item {
258|             Text(text = "Settings", style = MaterialTheme.typography.titleLarge)
259|         }
260| 
261|         item {
262|             WorkStatusCard(
263|                 snapshot = employmentSnapshot,
264|                 onChangeStatus = { showEmploymentStatusSheet = true },
265|                 onEndRole = {
266|                     val role = employmentSnapshot.role ?: return@WorkStatusCard
267|                     scope.launch {
268|                         employmentRepository.endRole(role.id)
269|                         employmentRepository.setStatus(
270|                            state = EmploymentState.UNEMPLOYED,
271|                            since = System.currentTimeMillis(),
272|                            currentRoleId = null
273|                        )
274|                    }
275|                },
276|                onAddRole = { showAddRoleSheet = true }
277|            )
278|        }
279| 
280|        item {
281|            Text(text = "Get started", style = MaterialTheme.typography.titleMedium)
282|            ChecklistRow(
283|                label = "Sign in to Junction",
284|                done = user != null,
285|                detail = user?.email
286|            )
287|            ChecklistRow(
288|                label = "Set Realtime client secret endpoint",
289|                done = realtimeClientSecretEndpoint.isNotBlank(),
290|                detail = realtimeClientSecretEndpoint.ifBlank { "Missing endpoint" }
291|            )
292|            ChecklistRow(
293|                label = "Set HTTP backend base URL",
294|                done = apiBaseUrl.isNotBlank(),
295|                detail = apiBaseUrl.ifBlank { "Missing base URL" }
296|            )
297|        }
298| 
299|         item {
300|             Text(text = "Copilot (experimental)", style = MaterialTheme.typography.titleMedium)
301|             Text(
302|                 text = "Enable Copilot to let Junction propose actions (open apps, follow links). Actions that are medium or high risk will always ask for confirmation.",
303|                 style = MaterialTheme.typography.bodyMedium
304|             )
305|             Row(
306|                 modifier = Modifier.fillMaxWidth(),
307|                 verticalAlignment = Alignment.CenterVertically,
308|                 horizontalArrangement = Arrangement.SpaceBetween
309|             ) {
310|                 Text(text = "Enable Copilot mode", style = MaterialTheme.typography.bodyMedium)
311|                 Switch(
312|                     checked = copilotEnabled,
313|                     onCheckedChange = { enabled ->
314|                         scope.launch { userPrefs.setCopilotEnabled(enabled) }
315|                     }
316|                 )
317|             }
318|         }
319| 
320| ...
