/**
 * @file utils/algoCore/exitPriceCalculator.js
 * @description Calculates a projected price target based on a geometric circle method.
 */

/**
 * Calculates a projected exit price using a dynamic scaling factor to normalize
 * the relationship between price and time.
 *
 * @param {object} params - The parameters for the calculation.
 * @param {'LONG' | 'SHORT'} params.signalType - The type of signal.
 * @param {number} params.triggerPrice - The price at the center of the circle.
 * @param {object} params.pivot - The historical pivot point { high, low, date }.
 * @param {number} params.timeDifference - The number of bars (ΔT) between the trigger and pivot.
 * @param {number} params.scalingFactor - The dynamic price-to-bar ratio (e.g., from ATR).
 * @returns {number | null} The calculated projected exit price, or null if inputs are invalid.
 */
export function calculateProjectedExit({
  signalType,
  triggerPrice,
  pivot,
  timeDifference,
  scalingFactor = 1, // Default to 1 to prevent crashes if not provided
}) {
  if (
    !signalType ||
    !triggerPrice ||
    !pivot ||
    timeDifference === undefined ||
    scalingFactor <= 0
  ) {
    return null;
  }

  const pivotPrice = signalType === "LONG" ? pivot.low : pivot.high;

  // 1. Calculate the raw price difference in dollars
  const deltaP_dollars = Math.abs(triggerPrice - pivotPrice);

  // 2. Normalize the price difference by the scaling factor to put it in "bar units"
  const deltaP_scaled = deltaP_dollars / scalingFactor;

  // 3. Calculate the radius using the Pythagorean theorem, now with comparable units
  const radius_scaled = Math.sqrt(
    Math.pow(timeDifference, 2) + Math.pow(deltaP_scaled, 2)
  );

  // 4. Convert the radius back from "bar units" to dollars to get the price projection
  const radius_dollars = radius_scaled * scalingFactor;

  let projectedExit = null;
  if (signalType === "LONG") {
    projectedExit = triggerPrice + radius_dollars;
  } else {
    // SHORT signal
    projectedExit = triggerPrice - radius_dollars;
  }

  return projectedExit;
}
