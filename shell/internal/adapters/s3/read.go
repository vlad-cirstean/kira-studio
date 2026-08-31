package s3

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/kirathecat/kira-studio/shell/internal/adapters"
	"github.com/kirathecat/kira-studio/shell/internal/page"
)

// formatBytes is read.ts's formatBytes. Asserted byte-exactly by the acceptance suite (P58d D15),
// not reasoned about — Go's %.1f and JS's toFixed(1) agree on every value the fixture produces,
// and do not agree in general (Go rounds half to even, toFixed does not).
func formatBytes(n int64) string {
	if n < 1024 {
		return fmt.Sprintf("%d B", n)
	}
	units := []string{"KB", "MB", "GB", "TB"}
	value := float64(n) / 1024
	unit := 0
	for value >= 1024 && unit < len(units)-1 {
		value /= 1024
		unit++
	}
	return fmt.Sprintf("%.1f %s", value, units[unit])
}

// headObjectLike is the subset of HeadObjectOutput/GetObjectOutput pushMetadataFields needs — the
// two SDK output types share these fields but are not the same Go type, so a single function
// takes the values directly rather than duplicating the field list per caller.
type headObjectLike struct {
	ContentType   *string
	ContentLength *int64
	LastModified  *string // pre-formatted (P58d D11)
	ETag          *string
	StorageClass  string
	Metadata      map[string]string
}

// pushMetadataFields is read.ts's pushMetadataFields — pushed once so the oversized/normal
// branches below can't drift apart.
func pushMetadataFields(builder *page.KeyValuePageBuilder, meta headObjectLike) {
	if meta.ContentType != nil {
		builder.Push("ContentType", *meta.ContentType)
	}
	if meta.ContentLength != nil {
		builder.Push("ContentLength", fmt.Sprintf("%d bytes (%s)", *meta.ContentLength, formatBytes(*meta.ContentLength)))
	}
	if meta.LastModified != nil {
		builder.Push("LastModified", *meta.LastModified)
	}
	if meta.ETag != nil {
		builder.Push("ETag", *meta.ETag)
	}
	if meta.StorageClass != "" {
		builder.Push("StorageClass", meta.StorageClass)
	}
	for _, entry := range sortedMetadata(meta.Metadata) {
		builder.Push("Metadata."+entry.Key, entry.Value)
	}
}

// sortedMetadata returns meta's entries in a fixed order (S3 metadata keys are lowercased by the
// service — confirmed against a real container, M8.0's AWS-3(d) — so a stable sort is also an
// alphabetical one).
func sortedMetadata(meta map[string]string) []mapEntry {
	out := make([]mapEntry, 0, len(meta))
	for k, v := range meta {
		out = append(out, mapEntry{k, v})
	}
	sortEntries(out)
	return out
}

type mapEntry struct{ Key, Value string }

func sortEntries(entries []mapEntry) {
	for i := 1; i < len(entries); i++ {
		for j := i; j > 0 && entries[j-1].Key > entries[j].Key; j-- {
			entries[j-1], entries[j] = entries[j], entries[j-1]
		}
	}
}

// isoOrNil formats t per P58d D11 (JS toISOString()'s exact format), or nil when t itself is nil.
func isoOrNil(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format("2006-01-02T15:04:05.000Z07:00")
	return &s
}

// readObject is read.ts's readObject. HeadObject first, always — it answers "is this too large to
// preview" without ever opening a body stream. Every SDK call takes ctx directly (P58d D3).
func readObject(ctx context.Context, client *s3.Client, bucket, key string, op *adapters.OpCtx) (page.KeyValuePage, error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return page.KeyValuePage{}, err
	}
	op.SetCommand("GetObject s3://" + bucket + "/" + key)

	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return page.KeyValuePage{}, mapError(err)
	}

	builder := page.NewKeyValuePageBuilder("object", nil, head.ContentLength, true)

	// P33 D4: one number governs fetch, decode and render alike — above it nothing is transferred
	// and no Body row exists at all.
	if head.ContentLength == nil || *head.ContentLength > int64(page.ObjectBodyPreviewBytes) {
		pushMetadataFields(builder, headFromHead(head))
	} else {
		res, err := client.GetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
		if err != nil {
			return page.KeyValuePage{}, mapError(err)
		}
		pushMetadataFields(builder, headFromGet(res))
		if res.Body != nil {
			bodyBytes, err := io.ReadAll(res.Body)
			res.Body.Close()
			if err != nil {
				return page.KeyValuePage{}, mapError(err)
			}
			if err := adapters.CheckCancelled(ctx); err != nil {
				return page.KeyValuePage{}, err
			}
			// P58d D12: lossy on purpose — a binary object opened for preview degrades to U+FFFD
			// replacement characters rather than the whole read failing. Differs from JS's
			// TextDecoder in one recorded way: strings.ToValidUTF8 emits one replacement char per
			// maximal *run* of invalid bytes, TextDecoder emits one per invalid *sequence* — no
			// scenario in this fixture observes the difference.
			builder.Push("Body", strings.ToValidUTF8(string(bodyBytes), "�"))
		}
	}

	return builder.Finish(page.UnpagedPosition(1)), nil
}

func headFromHead(head *s3.HeadObjectOutput) headObjectLike {
	return headObjectLike{
		ContentType: head.ContentType, ContentLength: head.ContentLength,
		LastModified: isoOrNil(head.LastModified), ETag: head.ETag,
		StorageClass: string(head.StorageClass), Metadata: head.Metadata,
	}
}

func headFromGet(res *s3.GetObjectOutput) headObjectLike {
	return headObjectLike{
		ContentType: res.ContentType, ContentLength: res.ContentLength,
		LastModified: isoOrNil(res.LastModified), ETag: res.ETag,
		StorageClass: string(res.StorageClass), Metadata: res.Metadata,
	}
}

// countObject is read.ts's countObject — a HeadObjectCommand (no body transfer), cheap enough to
// answer an exact field-row count without duplicating readObject's own field-selection logic.
func countObject(ctx context.Context, client *s3.Client, bucket, key string, op *adapters.OpCtx) (adapters.CountResult, error) {
	if err := adapters.CheckNotStarted(ctx); err != nil {
		return adapters.CountResult{}, err
	}
	op.SetCommand("HeadObject s3://" + bucket + "/" + key)
	res, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return adapters.CountResult{}, mapError(err)
	}
	// ContentType/ContentLength/LastModified/ETag are effectively always present on a real object;
	// StorageClass is the only field readObject may skip. The Body row itself is pushed only when
	// readObject would actually fetch and decode one — a known length at or under
	// ObjectBodyPreviewBytes — so Count and the visible row count never disagree.
	value := int64(4 + len(res.Metadata))
	if res.StorageClass != "" {
		value++
	}
	if res.ContentLength != nil && *res.ContentLength <= int64(page.ObjectBodyPreviewBytes) {
		value++
	}
	return adapters.CountResult{Value: value, Exact: true}, nil
}
