const SVG = "http://www.w3.org/2000/svg";
const WIDTH = 160;
const HEIGHT = 40;
const PAD = 3;

/**
 * A line of daily values in the product's colour, with no chart library. Fewer than two points draws nothing.
 * @param {number[]} points oldest first
 * @param {string} label what the line shows, for screen readers
 * @returns {SVGSVGElement | null}
 */
export function sparkline(points, label) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = (WIDTH - PAD * 2) / (points.length - 1);
  const coordinates = points
    .map((value, n) => {
      const x = PAD + n * step;
      const y = HEIGHT - PAD - ((value - min) / span) * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const svg = document.createElementNS(SVG, "svg");
  for (const [name, value] of Object.entries({
    class: "sparkline",
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    preserveAspectRatio: "none",
    role: "img",
    "aria-label": `${label}: ${points[0]} to ${points[points.length - 1]} over the last ${points.length} days`,
  }))
    svg.setAttribute(name, value);
  const line = document.createElementNS(SVG, "polyline");
  for (const [name, value] of Object.entries({
    points: coordinates,
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linejoin": "round",
    "stroke-linecap": "round",
    "vector-effect": "non-scaling-stroke",
  }))
    line.setAttribute(name, value);
  svg.append(line);
  return svg;
}
