package com.splinch.junction.feature.calculator.ui

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuAnchorType
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.splinch.junction.feature.calculator.BuildCategoryRequest
import com.splinch.junction.feature.calculator.CalculatorClient
import com.splinch.junction.feature.calculator.Listing
import com.splinch.junction.feature.calculator.SuggestBuildRequest
import com.splinch.junction.feature.calculator.SuggestedBuild
import com.splinch.junction.feature.calculator.model.CPU_RANK
import com.splinch.junction.feature.calculator.model.CPU_SPECS
import com.splinch.junction.feature.calculator.model.GPU_RANK
import com.splinch.junction.feature.calculator.model.GPU_SPECS
import com.splinch.junction.feature.calculator.model.ITEM_KEYS
import com.splinch.junction.feature.calculator.model.PRICED_ITEM_KEYS
import com.splinch.junction.feature.calculator.model.TIERS
import com.splinch.junction.feature.calculator.model.Tier
import com.splinch.junction.feature.calculator.model.rankColor
import kotlinx.coroutines.launch
import java.util.Locale

private fun fmt(value: Double): String = "£" + String.format(Locale.UK, "%.2f", value)

private fun rankMapFor(key: String, tierId: Int): Map<String, Double>? = when (key) {
    "CPU" -> CPU_RANK[tierId]
    "GPU" -> GPU_RANK[tierId]
    else -> null
}

private val moneyKeyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal)

@Composable
fun CalculatorScreen(
    client: CalculatorClient,
    modifier: Modifier = Modifier
) {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    var tierId by remember { mutableStateOf(1) }
    val tier = TIERS.getValue(tierId)

    var selections by remember(tierId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var costs by remember(tierId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var deliveryNotes by remember(tierId) { mutableStateOf("") }

    var sellPriceInput by remember { mutableStateOf("") }
    var feePctInput by remember { mutableStateOf("6.9") }

    var listingsForKey by remember { mutableStateOf<String?>(null) }
    var listings by remember { mutableStateOf<List<Listing>>(emptyList()) }
    var listingsLoading by remember { mutableStateOf(false) }
    var listingsError by remember { mutableStateOf<String?>(null) }

    var suggestion by remember(tierId) { mutableStateOf<SuggestedBuild?>(null) }
    var suggestLoading by remember { mutableStateOf(false) }
    var suggestError by remember { mutableStateOf<String?>(null) }

    val totalCost = ITEM_KEYS.sumOf { key -> costs[key]?.toDoubleOrNull() ?: 0.0 }
    val sellPrice = sellPriceInput.toDoubleOrNull() ?: 0.0
    val feePct = feePctInput.toDoubleOrNull() ?: 0.0
    val feeAmt = sellPrice * (feePct / 100)
    val netProfit = sellPrice - totalCost - feeAmt
    val margin = if (sellPrice > 0) netProfit / sellPrice * 100 else 0.0
    val roi = if (totalCost > 0) netProfit / totalCost * 100 else 0.0

    Column(
        modifier = modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text(text = "Build Calculator", style = MaterialTheme.typography.titleLarge)
        Text(
            text = "Pick a tier, choose parts, price them live against your PC's eBay daemon.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Spacer(Modifier.height(16.dp))

        SectionCard(title = "Build tier") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                TIERS.values.sortedBy { it.id }.forEach { t ->
                    val selected = t.id == tierId
                    val onClick = {
                        tierId = t.id
                        listingsForKey = null
                    }
                    if (selected) {
                        Button(onClick = onClick, modifier = Modifier.weight(1f)) {
                            Text(t.label, style = MaterialTheme.typography.labelSmall)
                        }
                    } else {
                        OutlinedButton(onClick = onClick, modifier = Modifier.weight(1f)) {
                            Text(t.label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        SectionCard(title = "Parts worksheet") {
            ITEM_KEYS.forEach { key ->
                PartRow(
                    itemKey = key,
                    tier = tier,
                    tierId = tierId,
                    selection = selections[key].orEmpty(),
                    onSelectionChange = { selections = selections + (key to it) },
                    cost = costs[key].orEmpty(),
                    onCostChange = { costs = costs + (key to it) },
                    deliveryNotes = deliveryNotes,
                    onDeliveryNotesChange = { deliveryNotes = it },
                    onBrowse = {
                        listingsForKey = key
                        listingsError = null
                        listings = emptyList()
                        listingsLoading = true
                        scope.launch {
                            client.searchListings(selections[key].orEmpty()).fold(
                                onSuccess = { listings = it; listingsLoading = false },
                                onFailure = { listingsError = it.message; listingsLoading = false }
                            )
                        }
                    }
                )
                if (key == listingsForKey) {
                    ListingsPanel(
                        loading = listingsLoading,
                        error = listingsError,
                        listings = listings,
                        onUse = { price -> costs = costs + (key to String.format(Locale.UK, "%.2f", price)) }
                    )
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
            }
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Text("Total build cost", fontWeight = FontWeight.SemiBold)
                Text(fmt(totalCost), fontWeight = FontWeight.SemiBold)
            }
        }

        Spacer(Modifier.height(12.dp))

        SectionCard(title = "Sale calculation") {
            OutlinedTextField(
                value = sellPriceInput,
                onValueChange = { sellPriceInput = it },
                label = { Text("Expected selling price (£)") },
                keyboardOptions = moneyKeyboardOptions,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = feePctInput,
                onValueChange = { feePctInput = it },
                label = { Text("Marketplace fee (%)") },
                keyboardOptions = moneyKeyboardOptions,
                modifier = Modifier.fillMaxWidth()
            )
            Spacer(Modifier.height(12.dp))
            TotalsRow("Marketplace fee", fmt(feeAmt))
            TotalsRow("Net profit", fmt(netProfit), good = netProfit >= 0)
            TotalsRow("Profit margin", String.format(Locale.UK, "%.1f%%", margin), good = margin >= 25)
            TotalsRow("Return on build cost", String.format(Locale.UK, "%.1f%%", roi), good = roi >= 0)

            if (sellPrice > 0) {
                Spacer(Modifier.height(8.dp))
                val message = when {
                    netProfit < 0 -> "Loss-making at this cost. Build cost exceeds selling price minus fees by ${fmt(-netProfit)}."
                    margin < 25 -> {
                        val maxCost = sellPrice * 0.75 - feeAmt
                        "Below 25% margin target. Reduce build cost to ${fmt(maxCost)} or raise selling price."
                    }
                    else -> "Margin target met."
                }
                Text(
                    message,
                    color = if (netProfit < 0 || margin < 25) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "${tier.label} starting target: likely sale ${fmt(tier.likelySale)}, max cost at 25% margin before fees " +
                    "${fmt(tier.maxCostAt25)}, suggested GPU class ${tier.gpuClass}.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        Spacer(Modifier.height(12.dp))

        SectionCard(title = "Suggested build (daemon)") {
            Text(
                "Prices every candidate part for this tier against your PC's eBay daemon and picks the " +
                    "cheapest sensible combination, then estimates a sale price from comparable current listings.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                suggestError = null
                suggestLoading = true
                suggestion = null
                val categories = PRICED_ITEM_KEYS.associateWith { key ->
                    BuildCategoryRequest(
                        options = tier.groups[key].orEmpty(),
                        rank = rankMapFor(key, tierId)
                    )
                }
                scope.launch {
                    client.suggestBuild(
                        SuggestBuildRequest(
                            categories = categories,
                            comparableQuery = "",
                            fallbackSalePrice = tier.likelySale,
                            feePct = feePct.takeIf { it > 0 } ?: 6.9
                        )
                    ).fold(
                        onSuccess = { suggestion = it; suggestLoading = false },
                        onFailure = { suggestError = it.message; suggestLoading = false }
                    )
                }
            }) {
                Text("Suggest a build for this tier")
            }

            if (suggestLoading) {
                Spacer(Modifier.height(8.dp))
                CircularProgressIndicator()
            }
            suggestError?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }
            suggestion?.let { s ->
                Spacer(Modifier.height(8.dp))
                s.picks.forEach { (key, pick) ->
                    TotalsRow(key, "${pick.option} — ${fmt(pick.price)}")
                }
                HorizontalDivider(Modifier.padding(vertical = 8.dp))
                TotalsRow("Suggested build cost", fmt(s.totalCost))
                TotalsRow(
                    "Recommended sale price",
                    "${fmt(s.recommendedSalePrice.value)} (${s.recommendedSalePrice.source}, ${s.recommendedSalePrice.sampleSize} comps)"
                )
                TotalsRow("Estimated margin", String.format(Locale.UK, "%.1f%%", s.margin), good = s.margin >= 25)
                TotalsRow("Estimated ROI", String.format(Locale.UK, "%.1f%%", s.roi), good = s.roi >= 0)
                Spacer(Modifier.height(8.dp))
                Button(onClick = {
                    selections = selections + s.picks.mapValues { it.value.option }
                    costs = costs + s.picks.mapValues { String.format(Locale.UK, "%.2f", it.value.price) }
                    sellPriceInput = String.format(Locale.UK, "%.2f", s.recommendedSalePrice.value)
                }) {
                    Text("Apply suggested build to worksheet")
                }
            }
        }

        Spacer(Modifier.height(12.dp))

        SectionCard(title = "Comparable build market check") {
            Text(
                "Opens a targeted web search for comparable sold builds using the selected CPU, GPU, RAM and SSD. " +
                    "eBay has no public sold-listings API, so this stays a search deep-link rather than a live call.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(Modifier.height(8.dp))
            Button(onClick = {
                val bits = listOfNotNull(
                    selections["CPU"], selections["GPU"], selections["RAM"], selections["SSD"]
                ).filter { it.isNotBlank() }
                val query = bits.joinToString(" ")
                val search = "site:ebay.co.uk/itm \"$query\" gaming pc sold"
                val url = "https://www.google.com/search?q=" + Uri.encode(search)
                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
            }) {
                Text("Find comparable sold build")
            }
        }

        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun SectionCard(title: String, content: @Composable ColumnScope.() -> Unit) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

@Composable
private fun TotalsRow(label: String, value: String, good: Boolean? = null) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(label, style = MaterialTheme.typography.bodyMedium)
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Medium,
            color = when (good) {
                true -> MaterialTheme.colorScheme.primary
                false -> MaterialTheme.colorScheme.error
                null -> MaterialTheme.colorScheme.onSurface
            }
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PartRow(
    itemKey: String,
    tier: Tier,
    tierId: Int,
    selection: String,
    onSelectionChange: (String) -> Unit,
    cost: String,
    onCostChange: (String) -> Unit,
    deliveryNotes: String,
    onDeliveryNotesChange: (String) -> Unit,
    onBrowse: () -> Unit
) {
    val options = tier.groups[itemKey]

    Text(itemKey, style = MaterialTheme.typography.labelLarge)
    Spacer(Modifier.height(4.dp))

    if (options == null) {
        OutlinedTextField(
            value = deliveryNotes,
            onValueChange = onDeliveryNotesChange,
            label = { Text("Notes (optional)") },
            modifier = Modifier.fillMaxWidth()
        )
    } else {
        val rankMap = rankMapFor(itemKey, tierId)
        var expanded by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
            OutlinedTextField(
                value = selection,
                onValueChange = {},
                readOnly = true,
                label = { Text("Select part") },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = expanded) },
                modifier = Modifier
                    .fillMaxWidth()
                    .menuAnchor(MenuAnchorType.PrimaryNotEditable)
            )
            ExposedDropdownMenuDefaults.DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
                options.forEach { option ->
                    val bg = rankMap?.get(option)?.let { rankColor(it) } ?: Color.Transparent
                    DropdownMenuItem(
                        text = { Text(option) },
                        onClick = { onSelectionChange(option); expanded = false },
                        modifier = Modifier.background(bg)
                    )
                }
            }
        }

        if (itemKey == "CPU") {
            val spec = CPU_SPECS[selection]
            Text(
                if (spec != null) "${spec.cores}C/${spec.threads}T · ${spec.clock}" else "Select a CPU to see cores/threads/speed",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        } else if (itemKey == "GPU") {
            val spec = GPU_SPECS[selection]
            Text(
                spec?.vram ?: "Select a GPU to see VRAM",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }

    Spacer(Modifier.height(4.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        OutlinedTextField(
            value = cost,
            onValueChange = onCostChange,
            label = { Text("Cost (£)") },
            keyboardOptions = moneyKeyboardOptions,
            modifier = Modifier.weight(1f)
        )
        if (itemKey in PRICED_ITEM_KEYS) {
            Spacer(Modifier.width(8.dp))
            TextButton(onClick = onBrowse, enabled = selection.isNotBlank()) {
                Text("Browse eBay ↗")
            }
        }
    }
}

@Composable
private fun ListingsPanel(
    loading: Boolean,
    error: String?,
    listings: List<Listing>,
    onUse: (Double) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Column(Modifier.padding(12.dp)) {
            if (loading) {
                CircularProgressIndicator()
            } else if (error != null) {
                Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            } else if (listings.isEmpty()) {
                Text("No current listings found.", style = MaterialTheme.typography.bodySmall)
            } else {
                listings.take(10).forEach { listing ->
                    Row(
                        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column(Modifier.weight(1f)) {
                            Text(listing.title, style = MaterialTheme.typography.bodySmall, maxLines = 2)
                            Text(
                                fmt(listing.price) + if (listing.condition.isNotBlank()) " · ${listing.condition}" else "",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        }
                        TextButton(onClick = { onUse(listing.price) }) {
                            Text("Use")
                        }
                    }
                }
            }
        }
    }
}
