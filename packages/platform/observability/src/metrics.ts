import {
  metrics,
  type Attributes,
  type Counter,
  type Histogram,
  type MetricOptions,
} from '@opentelemetry/api';

const meter = metrics.getMeter('@legalintel/observability');

const counters = new Map<string, Counter>();
const histograms = new Map<string, Histogram>();

/**
 * Instruments are created once per name. Attribute values must be low-cardinality
 * (stage names, outcomes) and never identifiers of people or documents.
 */
export function incrementCounter(
  name: string,
  attributes: Attributes = {},
  options?: MetricOptions,
  value = 1,
): void {
  let counter = counters.get(name);
  if (counter === undefined) {
    counter = meter.createCounter(name, options);
    counters.set(name, counter);
  }
  counter.add(value, attributes);
}

export function recordHistogram(
  name: string,
  value: number,
  attributes: Attributes = {},
  options?: MetricOptions,
): void {
  let histogram = histograms.get(name);
  if (histogram === undefined) {
    histogram = meter.createHistogram(name, options);
    histograms.set(name, histogram);
  }
  histogram.record(value, attributes);
}
