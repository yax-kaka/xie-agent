package com.ai.assistance.operit.util

import android.content.res.Configuration
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.Locale
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class LocaleUtilsConfigurationAndroidTest {

    @Test fun localeOverride_onlyDefinesLocaleFields() {
        val override = LocaleUtils.createLocaleOverrideConfiguration(Locale.US)

        assertEquals(Locale.US, override.locales[0])
        assertEquals(Configuration.ORIENTATION_UNDEFINED, override.orientation)
        assertEquals(Configuration.SCREEN_WIDTH_DP_UNDEFINED, override.screenWidthDp)
        assertEquals(Configuration.SCREEN_HEIGHT_DP_UNDEFINED, override.screenHeightDp)
        assertEquals(
            Configuration.SMALLEST_SCREEN_WIDTH_DP_UNDEFINED,
            override.smallestScreenWidthDp
        )
    }

    @Test fun localizedContext_inheritsBaseWindowDimensions() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val baseConfiguration = context.resources.configuration
        val localizedContext =
            context.createConfigurationContext(
                LocaleUtils.createLocaleOverrideConfiguration(Locale.US)
            )
        val localizedConfiguration = localizedContext.resources.configuration

        assertEquals(baseConfiguration.orientation, localizedConfiguration.orientation)
        assertEquals(baseConfiguration.screenWidthDp, localizedConfiguration.screenWidthDp)
        assertEquals(baseConfiguration.screenHeightDp, localizedConfiguration.screenHeightDp)
        assertEquals(
            baseConfiguration.smallestScreenWidthDp,
            localizedConfiguration.smallestScreenWidthDp
        )
    }
}
