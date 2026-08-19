package com.splinch.junction.feature.calculator.model

import androidx.compose.ui.graphics.Color

/**
 * Ported from the original standalone "Gaming PC Build Calculator" HTML tool.
 * `groups[key] == null` means that row is a free-text notes field (only "Delivery"),
 * not a priced/searchable part.
 */
data class Tier(
    val id: Int,
    val label: String,
    val likelySale: Double,
    val maxCostAt25: Double,
    val gpuClass: String,
    val groups: Map<String, List<String>?>
)

data class CpuSpec(val cores: Int, val threads: Int, val clock: String)
data class GpuSpec(val vram: String)

/** Row order for the parts worksheet. */
val ITEM_KEYS = listOf(
    "Donor PC or case", "CPU", "Motherboard", "GPU", "RAM", "SSD", "PSU", "Cooler", "Delivery"
)

/** Rows priced/searched against the eBay backend. Case/donor and delivery stay manual entry. */
val PRICED_ITEM_KEYS = listOf("CPU", "Motherboard", "GPU", "RAM", "SSD", "PSU", "Cooler")

val TIERS: Map<Int, Tier> = mapOf(
    1 to Tier(
        id = 1,
        label = "Tier 1 — Entry gaming",
        likelySale = 325.0,
        maxCostAt25 = 243.75,
        gpuClass = "GTX 1650 / RX 6400",
        groups = mapOf(
            "Donor PC or case" to listOf(
                "HP ProDesk 400 G5 MT", "HP ProDesk 600 G4 MT", "HP ProDesk 600 G5 MT",
                "Dell OptiPlex 3060 MT", "Dell OptiPlex 5060 MT", "Lenovo ThinkCentre M720T",
                "Separate case and motherboard build", "Other compatible donor PC"
            ),
            "CPU" to listOf(
                "Intel Core i3-8100", "Intel Core i3-9100", "Intel Core i3-9100F",
                "Intel Core i5-8400", "Intel Core i5-9400F"
            ),
            "Motherboard" to listOf(
                "Original donor motherboard", "B360 motherboard", "B365 motherboard",
                "CPU/motherboard/RAM bundle", "Other compatible motherboard"
            ),
            "GPU" to listOf(
                "RX 6400 4GB", "GTX 1650 4GB GDDR5, slot-powered", "GTX 1650 4GB GDDR6, slot-powered",
                "GTX 1650 4GB with external power", "RX 6500 XT 4GB", "GTX 1650 Super 4GB",
                "GTX 1060 3GB", "GTX 1060 6GB"
            ),
            "RAM" to listOf("16GB DDR4, 2×8GB", "32GB DDR4, 2×16GB"),
            "SSD" to listOf(
                "New 500GB NVMe SSD", "New 1TB NVMe SSD", "New 480–500GB SATA SSD",
                "New NVMe SSD plus secondary HDD (1TB)", "New NVMe SSD plus secondary HDD (2TB)",
                "SSD included with donor", "Other storage configuration"
            ),
            "PSU" to listOf(
                "New branded 450W PSU", "New branded 500–550W PSU",
                "PSU included with case or bundle", "Other PSU"
            ),
            "Cooler" to listOf(
                "Donor case, cleaned cooler and fresh thermal paste", "Donor case with a new CPU cooler",
                "New airflow case with stock/OEM cooler", "New airflow case with tower cooler",
                "Additional case fan", "Other cooling or case arrangement"
            ),
            "Delivery" to null
        )
    ),
    2 to Tier(
        id = 2,
        label = "Tier 2 — Mainstream 1080p",
        likelySale = 475.0,
        maxCostAt25 = 356.25,
        gpuClass = "GTX 1660 Super / RX 6600",
        groups = mapOf(
            "Donor PC or case" to listOf(
                "Dell OptiPlex 5060 MT", "Dell OptiPlex 7060 MT", "Dell OptiPlex XE3 MT",
                "HP ProDesk 600 G4 MT", "HP ProDesk 600 G5 MT", "HP EliteDesk 800 G4 Tower",
                "HP EliteDesk 800 G5 Tower", "Lenovo ThinkCentre M920T",
                "Separate case and motherboard build", "Other compatible donor PC"
            ),
            "CPU" to listOf(
                "Intel Core i5-8500", "Intel Core i5-9500", "Intel Core i5-8600",
                "Intel Core i5-9600", "Intel Core i5-9600K"
            ),
            "Motherboard" to listOf(
                "Original donor motherboard", "B360 motherboard", "B365 motherboard",
                "Z370 motherboard", "CPU/motherboard/RAM bundle", "Other compatible motherboard"
            ),
            "GPU" to listOf(
                "GTX 1650 Super 4GB", "RX 5500 XT 8GB", "GTX 1660 6GB", "RTX 3050 8GB",
                "GTX 1660 Super 6GB", "GTX 1660 Ti 6GB", "GTX 1070 8GB", "RX 5600 XT 6GB",
                "GTX 1080 8GB", "RTX 2060 6GB", "RX 6600 8GB"
            ),
            "RAM" to listOf("16GB DDR4, 2×8GB", "32GB DDR4, 2×16GB"),
            "SSD" to listOf(
                "New 500GB NVMe SSD", "New 1TB NVMe SSD", "New 1TB SATA SSD",
                "New NVMe SSD plus secondary HDD (1TB)", "New NVMe SSD plus secondary HDD (2TB)",
                "SSD included with donor", "Other storage configuration"
            ),
            "PSU" to listOf(
                "New branded 500W PSU", "New branded 550–600W PSU",
                "PSU included with case or bundle", "Other PSU"
            ),
            "Cooler" to listOf(
                "Donor case, cleaned cooler and fresh thermal paste", "Donor case with a new CPU cooler",
                "New airflow case with stock/OEM cooler", "New airflow case with tower cooler",
                "Additional case fan", "Other cooling or case arrangement"
            ),
            "Delivery" to null
        )
    ),
    3 to Tier(
        id = 3,
        label = "Tier 3 — Higher-spec gaming",
        likelySale = 700.0,
        maxCostAt25 = 525.00,
        gpuClass = "RX 6600 XT / RTX 3060",
        groups = mapOf(
            "Donor PC or case" to listOf(
                "HP Z2 G4 Tower", "HP Z2 G5 Tower", "HP EliteDesk 800 G4 Tower",
                "HP EliteDesk 800 G5 Tower", "Lenovo ThinkStation P330 Tower",
                "Dell Precision 3630 Tower", "Dell Precision 3640 Tower", "Dell OptiPlex XE3 MT",
                "Separate mATX/ATX build", "Other compatible workstation or donor PC"
            ),
            "CPU" to listOf(
                "Intel Core i7-8700", "Intel Core i7-8700K", "Intel Core i7-9700",
                "Intel Core i7-9700F", "Intel Core i7-9700K"
            ),
            "Motherboard" to listOf(
                "Original workstation/donor motherboard", "B360 motherboard", "B365 motherboard",
                "Z370 motherboard", "Z390 motherboard", "CPU/motherboard/RAM bundle",
                "Other compatible motherboard"
            ),
            "GPU" to listOf(
                "RX 6600 8GB", "RX 6600 XT 8GB", "RTX 2060 Super 8GB", "RX 6650 XT 8GB",
                "RTX 2070 8GB", "RTX 2070 Super 8GB", "RTX 3060 12GB"
            ),
            "RAM" to listOf("16GB DDR4, 2×8GB", "32GB DDR4, 2×16GB"),
            "SSD" to listOf(
                "New 1TB NVMe SSD", "New 2TB NVMe SSD", "New 1TB SATA SSD",
                "New NVMe SSD plus secondary HDD (1TB)", "New NVMe SSD plus secondary HDD (2TB)",
                "Other storage configuration"
            ),
            "PSU" to listOf(
                "New branded 550W PSU", "New branded 600–650W PSU",
                "PSU included with case or bundle", "Other PSU"
            ),
            "Cooler" to listOf(
                "Donor case, cleaned cooler and fresh thermal paste", "Donor case with a new CPU cooler",
                "New airflow case with stock/OEM cooler", "New airflow case with tower cooler",
                "Additional case fan", "Other cooling or case arrangement"
            ),
            "Delivery" to null
        )
    )
)

val CPU_SPECS: Map<String, CpuSpec> = mapOf(
    "Intel Core i3-8100" to CpuSpec(4, 4, "3.6 GHz (no turbo)"),
    "Intel Core i3-9100" to CpuSpec(4, 4, "3.6 → 4.2 GHz"),
    "Intel Core i3-9100F" to CpuSpec(4, 4, "3.6 → 4.2 GHz"),
    "Intel Core i5-8400" to CpuSpec(6, 6, "2.8 → 4.0 GHz"),
    "Intel Core i5-9400F" to CpuSpec(6, 6, "2.9 → 4.1 GHz"),
    "Intel Core i5-8500" to CpuSpec(6, 6, "3.0 → 4.1 GHz"),
    "Intel Core i5-9500" to CpuSpec(6, 6, "3.0 → 4.4 GHz"),
    "Intel Core i5-8600" to CpuSpec(6, 6, "3.1 → 4.3 GHz"),
    "Intel Core i5-9600" to CpuSpec(6, 6, "3.1 → 4.6 GHz"),
    "Intel Core i5-9600K" to CpuSpec(6, 6, "3.7 → 4.6 GHz"),
    "Intel Core i7-8700" to CpuSpec(6, 12, "3.2 → 4.6 GHz"),
    "Intel Core i7-8700K" to CpuSpec(6, 12, "3.7 → 4.7 GHz"),
    "Intel Core i7-9700" to CpuSpec(8, 8, "3.0 → 4.7 GHz"),
    "Intel Core i7-9700F" to CpuSpec(8, 8, "3.0 → 4.7 GHz"),
    "Intel Core i7-9700K" to CpuSpec(8, 8, "3.6 → 4.9 GHz")
)

val GPU_SPECS: Map<String, GpuSpec> = mapOf(
    "RX 6400 4GB" to GpuSpec("4GB GDDR6"),
    "GTX 1650 4GB GDDR5, slot-powered" to GpuSpec("4GB GDDR5"),
    "GTX 1650 4GB GDDR6, slot-powered" to GpuSpec("4GB GDDR6"),
    "GTX 1650 4GB with external power" to GpuSpec("4GB GDDR6"),
    "RX 6500 XT 4GB" to GpuSpec("4GB GDDR6"),
    "GTX 1650 Super 4GB" to GpuSpec("4GB GDDR6"),
    "GTX 1060 3GB" to GpuSpec("3GB GDDR5"),
    "GTX 1060 6GB" to GpuSpec("6GB GDDR5"),
    "RX 5500 XT 8GB" to GpuSpec("8GB GDDR6"),
    "GTX 1660 6GB" to GpuSpec("6GB GDDR5"),
    "RTX 3050 8GB" to GpuSpec("8GB GDDR6"),
    "GTX 1660 Super 6GB" to GpuSpec("6GB GDDR6"),
    "GTX 1660 Ti 6GB" to GpuSpec("6GB GDDR6"),
    "GTX 1070 8GB" to GpuSpec("8GB GDDR5"),
    "RX 5600 XT 6GB" to GpuSpec("6GB GDDR6"),
    "GTX 1080 8GB" to GpuSpec("8GB GDDR5X"),
    "RTX 2060 6GB" to GpuSpec("6GB GDDR6"),
    "RX 6600 8GB" to GpuSpec("8GB GDDR6"),
    "RX 6600 XT 8GB" to GpuSpec("8GB GDDR6"),
    "RTX 2060 Super 8GB" to GpuSpec("8GB GDDR6"),
    "RX 6650 XT 8GB" to GpuSpec("8GB GDDR6"),
    "RTX 2070 8GB" to GpuSpec("8GB GDDR6"),
    "RTX 2070 Super 8GB" to GpuSpec("8GB GDDR6"),
    "RTX 3060 12GB" to GpuSpec("12GB GDDR6")
)

/** Relative in-tier performance rank, 0 (weakest) to 1 (strongest); used to shade dropdown options. */
val CPU_RANK: Map<Int, Map<String, Double>> = mapOf(
    1 to mapOf(
        "Intel Core i3-8100" to 0.0, "Intel Core i3-9100" to 0.2, "Intel Core i3-9100F" to 0.25,
        "Intel Core i5-8400" to 0.65, "Intel Core i5-9400F" to 1.0
    ),
    2 to mapOf(
        "Intel Core i5-8500" to 0.0, "Intel Core i5-9500" to 0.3, "Intel Core i5-8600" to 0.35,
        "Intel Core i5-9600" to 0.7, "Intel Core i5-9600K" to 1.0
    ),
    3 to mapOf(
        "Intel Core i7-8700" to 0.0, "Intel Core i7-8700K" to 0.3, "Intel Core i7-9700" to 0.55,
        "Intel Core i7-9700F" to 0.55, "Intel Core i7-9700K" to 1.0
    )
)

val GPU_RANK: Map<Int, Map<String, Double>> = mapOf(
    1 to mapOf(
        "RX 6400 4GB" to 0.0, "GTX 1650 4GB GDDR5, slot-powered" to 0.15,
        "GTX 1650 4GB GDDR6, slot-powered" to 0.3, "GTX 1650 4GB with external power" to 0.3,
        "RX 6500 XT 4GB" to 0.4, "GTX 1650 Super 4GB" to 0.55, "GTX 1060 3GB" to 0.6,
        "GTX 1060 6GB" to 1.0
    ),
    2 to mapOf(
        "GTX 1650 Super 4GB" to 0.0, "RX 5500 XT 8GB" to 0.05, "GTX 1660 6GB" to 0.2,
        "RTX 3050 8GB" to 0.25, "GTX 1660 Super 6GB" to 0.4, "GTX 1660 Ti 6GB" to 0.48,
        "GTX 1070 8GB" to 0.55, "RX 5600 XT 6GB" to 0.62, "GTX 1080 8GB" to 0.8,
        "RTX 2060 6GB" to 0.9, "RX 6600 8GB" to 1.0
    ),
    3 to mapOf(
        "RX 6600 8GB" to 0.0, "RX 6600 XT 8GB" to 0.25, "RTX 2060 Super 8GB" to 0.35,
        "RX 6650 XT 8GB" to 0.45, "RTX 2070 8GB" to 0.6, "RTX 2070 Super 8GB" to 0.8,
        "RTX 3060 12GB" to 1.0
    )
)

/** hue 0 (red, weakest) -> 120 (green, strongest), matching the original tool's shading. */
fun rankColor(rank: Double): Color =
    Color.hsl(hue = (rank.coerceIn(0.0, 1.0) * 120).toFloat(), saturation = 0.68f, lightness = 0.78f)
