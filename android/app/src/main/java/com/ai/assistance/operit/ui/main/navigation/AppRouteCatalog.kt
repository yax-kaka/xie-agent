package com.ai.assistance.operit.ui.main.navigation

import android.content.Context
import com.ai.assistance.operit.ui.main.screens.Screen
import com.ai.assistance.operit.ui.main.screens.ScreenRouteRegistry
import com.ai.assistance.operit.ui.common.NavItem

object AppRouteCatalog {
    fun build(context: Context): AppNavigationModel {
        return AppNavigationModel(
            routes = ScreenRouteRegistry.hostRouteSpecs(context),
            navigationEntries =
                (
                    ScreenRouteRegistry.mainSidebarEntries(context) +
                        ScreenRouteRegistry.toolboxEntries(context)
                    )
                    .sortedWith(
                        compareBy<NavigationEntrySpec>({ it.surface.ordinal }, { it.order }, { it.title })
                    )
        )
    }

    fun resolveScreen(model: AppNavigationModel, entry: RouteEntry): Screen? {
        ScreenRouteRegistry.screenFromEntry(entry)?.let { return it }
        return null
    }

    fun initialEntry(navItem: NavItem): RouteEntry {
        return ScreenRouteRegistry.initialEntry(navItem)
    }

    fun toEntry(
        screen: Screen,
        source: RouteEntrySource = RouteEntrySource.DEFAULT
    ): RouteEntry {
        return ScreenRouteRegistry.toEntry(screen = screen, source = source)
    }
}
