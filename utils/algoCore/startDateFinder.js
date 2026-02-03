import swisseph, {
  swe_julday,
  swe_calc_ut,
  swe_jdet_to_utc,
  SE_SUN,
  SEFLG_SWIEPH,
  SE_GREG_CAL,
} from "swisseph";

// --- Setup Swisseph (can be centralized if used elsewhere) ---
try {
  swisseph.swe_set_ephe_path(process.cwd() + "/public/ephe");
} catch (e) {
  console.error("Error setting ephemeris path in startDateFinder.");
}

// --- Reusable Solar Ingress Logic (Unchanged) ---
const INGRESS_LONGITUDES = { aries: 0, cancer: 90, libra: 180, capricorn: 270 };
const APPROXIMATE_INGRESS_DATES = {
  aries: { month: 3, day: 20 },
  cancer: { month: 6, day: 21 },
  libra: { month: 9, day: 22 },
  capricorn: { month: 12, day: 21 },
};

async function getSolarIngressUTC(year, sign) {
  const lowerCaseSign = sign.toLowerCase();
  const target_longitude = INGRESS_LONGITUDES[lowerCaseSign];
  const approx_date = APPROXIMATE_INGRESS_DATES[lowerCaseSign];
  const jd_guess = swe_julday(
    year,
    approx_date.month,
    approx_date.day,
    12,
    SE_GREG_CAL
  );
  let start_jd = jd_guess - 1.5,
    end_jd = jd_guess + 1.5;
  const PRECISION = 1e-9,
    MAX_ITERATIONS = 100;
  let ingress_jd_ut = 0;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const mid_jd = (start_jd + end_jd) / 2;
    const mid_sun = swe_calc_ut(mid_jd, SE_SUN, SEFLG_SWIEPH);
    if (mid_sun.error)
      throw new Error(`Swiss Ephemeris error: ${mid_sun.error}`);
    let difference = mid_sun.longitude - target_longitude;
    if (difference > 180) difference -= 360;
    if (difference < -180) difference += 360;
    if (Math.abs(end_jd - start_jd) < PRECISION) {
      ingress_jd_ut = mid_jd;
      break;
    }
    if (difference < 0) start_jd = mid_jd;
    else end_jd = mid_jd;
    ingress_jd_ut = mid_jd;
  }
  if (ingress_jd_ut === 0) throw new Error("Binary search failed to converge.");
  const ingress_utc = swe_jdet_to_utc(ingress_jd_ut, SE_GREG_CAL);
  return new Date(
    Date.UTC(
      ingress_utc.year,
      ingress_utc.month - 1,
      ingress_utc.day,
      ingress_utc.hour,
      ingress_utc.minute,
      ingress_utc.second
    )
  );
}

// --- (REWRITTEN) Function to find all major pivots in data ---
/**
 * Finds major swing pivots by iterating through each bar and looking back.
 * A bar is flagged as a "Major High Pivot" if its high is the highest high
 * over the previous N bars (the lookback period). This respects the principle
 * of only using past data.
 *
 * @param {Array} historicalData - The complete array of bar data.
 * @param {number} lookbackPeriod - The number of previous bars to check against.
 * @returns {Array} An array of all identified pivot objects { type, date, price }.
 */
function findMajorPivots(historicalData, lookbackPeriod) {
  const pivots = [];
  if (historicalData.length < lookbackPeriod) {
    console.warn("Not enough historical data to find major pivots.");
    return pivots;
  }

  // Iterate through every bar in the dataset, starting at the point
  // where we have enough data to look back.
  for (let i = lookbackPeriod; i < historicalData.length; i++) {
    const currentBar = historicalData[i];
    // Define the window of bars to check: from the current bar backwards.
    const lookbackWindow = historicalData.slice(i - lookbackPeriod, i);

    const maxHighInWindow = Math.max(...lookbackWindow.map((b) => b.high));
    const minLowInWindow = Math.min(...lookbackWindow.map((b) => b.low));

    // Check if the current bar's high is a new high for the period.
    if (currentBar.high > maxHighInWindow) {
      pivots.push({
        type: "High",
        date: currentBar.date,
        price: currentBar.high,
      });
    }

    // Check if the current bar's low is a new low for the period.
    if (currentBar.low < minLowInWindow) {
      pivots.push({
        type: "Low",
        date: currentBar.date,
        price: currentBar.low,
      });
    }
  }
  return pivots;
}

/**
 * Orchestrator function to get all start points based on the selected strategy.
 */
export async function findStartPoints({
  startDateType,
  yearStart,
  yearEnd,
  manualStartDate,
  allStockData,
  timeframe, // Keep timeframe for potential future use, though not for lookback size now
}) {
  let startPoints = [];

  if (startDateType === "ingress") {
    const signs = ["aries", "cancer", "libra", "capricorn"];
    for (let year = yearStart; year <= yearEnd; year++) {
      for (const sign of signs) {
        const ingressDate = await getSolarIngressUTC(year, sign);
        startPoints.push({
          name: `${year} ${
            sign.charAt(0).toUpperCase() + sign.slice(1)
          } Ingress`,
          date: ingressDate,
        });
      }
    }
  } else if (startDateType === "manual") {
    if (!manualStartDate) {
      throw new Error("Manual start date is required.");
    }
    const manualDate = new Date(manualStartDate);
    if (
      manualDate.getFullYear() >= yearStart &&
      manualDate.getFullYear() <= yearEnd
    ) {
      startPoints.push({ name: "Manual Start", date: manualDate });
    }
  } else if (startDateType === "auto") {
    // --- Use the fixed 180-bar lookback as requested ---
    const pivotLookback = 180;

    console.log(
      `[startDateFinder] Using a fixed lookback of ${pivotLookback} bars to find major pivots.`
    );

    const allMajorPivots = findMajorPivots(allStockData, pivotLookback);

    // Filter the found pivots to only include those within the user's selected backtest range.
    startPoints = allMajorPivots
      .filter((p) => {
        const pDate = new Date(p.date);
        return (
          pDate.getFullYear() >= yearStart && pDate.getFullYear() <= yearEnd
        );
      })
      .map((p) => ({
        name: `Auto ${p.type} Pivot ${
          new Date(p.date).toISOString().split("T")[0]
        }`,
        date: p.date,
      }));
  }

  return startPoints;
}
