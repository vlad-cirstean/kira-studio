package grpcclient

import (
	"container/list"
	"strconv"
	"testing"
)

// TestCacheKey_IgnoresMetadataValues is finding 12: reflection's own resolved metadata used to be
// hashed in full (name AND value), so a dynamic value substituted fresh per call (e.g. {{$guid}}
// in an auth header, an ordinary P6 feature) minted a brand-new cache key on every single call,
// guaranteeing a miss — defeating the documented "a Call following a Describe on the same Source
// costs no second reflection round trip" property. Metadata names still distinguish two Sources;
// only the value each name resolved to no longer does.
func TestCacheKey_IgnoresMetadataValues(t *testing.T) {
	base := Source{
		Mode: SourceReflection, Target: "api.example.com:443",
		Metadata: []MetaPair{{Name: "authorization", Value: "Bearer guid-1111"}},
	}
	sameNameDifferentValue := Source{
		Mode: SourceReflection, Target: "api.example.com:443",
		Metadata: []MetaPair{{Name: "authorization", Value: "Bearer guid-2222"}},
	}
	differentName := Source{
		Mode: SourceReflection, Target: "api.example.com:443",
		Metadata: []MetaPair{{Name: "x-tenant-id", Value: "Bearer guid-1111"}},
	}

	if cacheKey(base) != cacheKey(sameNameDifferentValue) {
		t.Errorf("cacheKey differs when only a metadata *value* changes — a dynamic value (e.g. {{$guid}}) would defeat the cache on every call")
	}
	if cacheKey(base) == cacheKey(differentName) {
		t.Errorf("cacheKey is identical when the metadata *name* changes — names should still distinguish two Sources")
	}
}

// TestDescriptorCache_EvictsLeastRecentlyUsedPastCap is finding 12's other half: the cache used to
// be an unbounded map, so a session that Describes many distinct Sources (each a possibly
// multi-megabyte descriptor registry) grew it without limit. Exercises descriptorCachePut/Get
// directly — synthetic keys and empty *resolved values, no real network or .proto file needed —
// since the eviction policy itself, not descriptor resolution, is what this guards.
func TestDescriptorCache_EvictsLeastRecentlyUsedPastCap(t *testing.T) {
	descriptorCache.mu.Lock()
	descriptorCache.byKey = map[string]*list.Element{}
	descriptorCache.order.Init()
	descriptorCache.mu.Unlock()

	keys := make([]string, 0, maxCachedDescriptors+5)
	for i := 0; i < maxCachedDescriptors+5; i++ {
		key := "synthetic-key-" + strconv.Itoa(i)
		keys = append(keys, key)
		descriptorCachePut(key, &resolved{})
	}

	// Touch the very first surviving key (keys[5], the oldest that wasn't already evicted just by
	// insertion order) so it becomes the most-recently-used — proving eviction is LRU, not FIFO by
	// insertion alone: the next insert must evict keys[6] (now the true least-recently-used), not
	// keys[5].
	if _, ok := descriptorCacheGet(keys[5]); !ok {
		t.Fatalf("keys[5] (%s) should still be cached before the touch", keys[5])
	}
	descriptorCachePut("one-more-key", &resolved{})

	if _, ok := descriptorCacheGet(keys[5]); !ok {
		t.Errorf("keys[5] was evicted despite being touched (moved to most-recently-used) just before the insert that should have evicted keys[6] instead")
	}
	if _, ok := descriptorCacheGet(keys[6]); ok {
		t.Errorf("keys[6] should have been evicted as the true least-recently-used entry, but is still cached")
	}

	// The cache never grew past its cap at any point.
	descriptorCache.mu.Lock()
	size := descriptorCache.order.Len()
	descriptorCache.mu.Unlock()
	if size > maxCachedDescriptors {
		t.Errorf("cache size = %d, want at most %d", size, maxCachedDescriptors)
	}
}
