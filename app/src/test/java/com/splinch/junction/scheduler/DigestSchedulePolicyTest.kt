package com.splinch.junction.scheduler

import com.splinch.junction.feed.model.FeedCategory
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DigestSchedulePolicyTest {
    @Test
    fun suppressesHoursInsideAnOvernightWindow() {
        val quietHours = DigestQuietHours(enabled = true, startHour = 22, endHour = 7)

        assertTrue(DigestSchedulePolicy.suppressesAtHour(22, quietHours))
        assertTrue(DigestSchedulePolicy.suppressesAtHour(6, quietHours))
        assertFalse(DigestSchedulePolicy.suppressesAtHour(12, quietHours))
    }

    @Test
    fun suppressesHoursInsideASameDayWindowOnly() {
        val quietHours = DigestQuietHours(enabled = true, startHour = 9, endHour = 17)

        assertTrue(DigestSchedulePolicy.suppressesAtHour(12, quietHours))
        assertFalse(DigestSchedulePolicy.suppressesAtHour(17, quietHours))
        assertFalse(DigestSchedulePolicy.suppressesAtHour(8, quietHours))
    }

    @Test
    fun equalHoursDoNotCreateAnAmbiguousAllDayWindow() {
        assertFalse(DigestSchedulePolicy.suppressesAtHour(12, DigestQuietHours(true, 8, 8)))
    }

    @Test
    fun profilesFilterDigestCategoriesWithoutMutingTheFeed() {
        assertTrue(DigestSchedulePolicy.includesCategory(DigestProfile.FOCUS, FeedCategory.WORK))
        assertTrue(DigestSchedulePolicy.includesCategory(DigestProfile.FOCUS, FeedCategory.PROJECTS))
        assertFalse(DigestSchedulePolicy.includesCategory(DigestProfile.FOCUS, FeedCategory.FRIENDS_FAMILY))
        assertTrue(DigestSchedulePolicy.includesCategory(DigestProfile.PERSONAL, FeedCategory.FRIENDS_FAMILY))
        assertFalse(DigestSchedulePolicy.includesCategory(DigestProfile.PERSONAL, FeedCategory.NEWS))
    }
}