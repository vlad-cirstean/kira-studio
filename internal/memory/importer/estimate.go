package importer

import "math"

// Constants from the P211 measurements (docs/ARCHITECTURE.md chunks of 2.2k to 3.5k tokens gave 20
// to 29 facts in 16 to 19 s each).
const (
	factsPerChunk     = 20
	extractSeconds    = 18
	finalizeBase      = 15
	finalizePerBatch  = 25
	factsPerBatch     = 20
	extractConcurrent = 3
)

// EstimateWork turns per-file chunk counts into calls and a duration: one extract call per chunk,
// one finalize call per file plus two store/search round trips per 20 facts; extraction runs
// extractConcurrent wide, finalize runs serially.
func EstimateWork(chunkCounts []int, tokens int) Estimate {
	e := Estimate{Files: len(chunkCounts), Tokens: tokens}
	finalize := 0
	for _, c := range chunkCounts {
		batches := int(math.Ceil(float64(c*factsPerChunk) / factsPerBatch))
		e.Chunks += c
		e.Calls += c + 1 + 2*batches
		finalize += finalizeBase + finalizePerBatch*batches
	}
	extract := int(math.Ceil(float64(e.Chunks)/extractConcurrent)) * extractSeconds
	e.Seconds = extract + finalize
	return e
}
