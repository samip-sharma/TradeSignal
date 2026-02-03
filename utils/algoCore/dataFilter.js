/**
 * @file utils/algoCore/dataFilter.js
 * @description Contains functions for cleaning and filtering market data.
 */

/**
 * Filters an array of market data bars to include ONLY those that fall within
 * regular trading hours (9:30 AM to 4:00 PM Eastern Time) on weekdays.
 *
 * This function is robust because it intelligently adapts its filtering logic
 * based on the provided timeframe to handle both minute-based and hourly bars correctly.
 *
 * @param {Array<Object>} bars - The array of bar data. Each object must have a `date` property which is a JavaScript Date object.
 * @param {string} timeframe - The timeframe of the bars (e.g., "1Hour", "15Min", "1Min").
 * @returns {Array<Object>} A new, filtered array containing only the bars from regular trading hours.
 */
export function filterToRTHAndWeekdays(bars, timeframe) {
  // Use the Intl.DateTimeFormat API for reliable time zone conversion to "America/New_York".
  // Using 24-hour format (hour12: false) simplifies the numeric comparisons.
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short", // e.g., "Mon", "Tue", "Sat"
    hour: "numeric", // e.g., 9, 15
    minute: "numeric", // e.g., 0, 30
    hour12: false,
  });

  return bars.filter((bar) => {
    try {
      const parts = formatter.formatToParts(bar.date);
      const dayPart = parts.find((p) => p.type === "weekday").value;
      const hourPart = parseInt(parts.find((p) => p.type === "hour").value);

      // 1. First, filter out all weekend bars.
      if (dayPart === "Sat" || dayPart === "Sun") {
        return false;
      }

      // 2. Next, apply the correct filtering logic based on the chart's timeframe.
      if (timeframe === "1Hour") {
        // --- HOURLY LOGIC ---
        // For an hourly chart, the trading session includes the entire bar in which
        // the market opens or closes.
        // - The 9:00 AM bar (hourPart = 9) contains the market open at 9:30.
        // - The 3:00 PM bar (hourPart = 15) is the last full hour before the 4:00 PM close.
        // Therefore, we include all hourly bars from 9 through 15.
        return hourPart >= 9 && hourPart <= 15;
      } else {
        // --- MINUTE-BASED LOGIC ---
        // For any timeframe smaller than an hour (e.g., 1Min, 5Min, 15Min),
        // we use a precise time check.
        const minutePart = parseInt(
          parts.find((p) => p.type === "minute").value
        );

        // Condition 1: Is the bar's start time at or after 9:30 AM?
        const isAfterMarketOpen =
          hourPart > 9 || (hourPart === 9 && minutePart >= 30);

        // Condition 2: Is the bar's start time before 4:00 PM?
        // (The last bar of the day is typically 15:59 for a 1-min chart).
        const isBeforeMarketClose = hourPart < 16;

        return isAfterMarketOpen && isBeforeMarketClose;
      }
    } catch (e) {
      // If a date can't be processed, log the error and exclude the bar.
      console.error("Could not format date for filtering:", bar.date, e);
      return false;
    }
  });
}
