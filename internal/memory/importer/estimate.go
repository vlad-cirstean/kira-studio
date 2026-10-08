package importer

import "math"

// Rough constants, replaced by measurements from the smoke run (P211 notes).
const (
	factsPerChunk     = 12
	extractSeconds    = 30
	finalizeBase      = 20
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
