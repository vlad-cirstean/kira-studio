package s3

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	smithy "github.com/aws/smithy-go"

	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/adapters"
	"github.com/kirathecat/kira-studio/apps/kira-studio/internal/storage/model"
)

// P33 D2/F10's sentinels, mirrored from packages/shared/domain/object-store.ts — edit, delete and
// upload ride the existing mutate() path with the same sentinel-through-RowValues technique
// redis/mutate.go established.
const (
	objectKeySentinel         = "_key"
	objectFileSentinel        = "$file"
	objectContentTypeSentinel = "$contentType"
)

// resolveBucketSegment is mutate's own single-bucket path check (P113 G2), same shape as redis's
// resolveDatabaseSegment. Message text moves from "bucket-rooted path" to RequirePath's fixed
// "bucket path" wording — no test or frontend code pins the old string.
func resolveBucketSegment(path model.NodePath) (string, error) {
	segs, err := adapters.RequirePath(path, "mutate", adapters.Seg("bucket"))
	if err != nil {
		return "", err
	}
	return segs[0].Name, nil
}

func keyFrom(values model.RowValues, label string) (string, error) {
	raw, ok := values.Get(objectKeySentinel)
	if !ok || raw == nil || *raw == "" {
		return "", adapters.New(adapters.CodeQuery, fmt.Sprintf("an s3 %s mutation requires a non-empty %s", label, objectKeySentinel), nil)
	}
	return *raw, nil
}

func fileFrom(values model.RowValues) (string, error) {
	raw, ok := values.Get(objectFileSentinel)
	if !ok || raw == nil || *raw == "" {
		return "", adapters.New(adapters.CodeUnsupported, "an s3 insert mutation requires a non-empty "+objectFileSentinel, nil)
	}
	return *raw, nil
}

func contentTypeFrom(values model.RowValues) *string {
	raw, ok := values.Get(objectContentTypeSentinel)
	if !ok || raw == nil || *raw == "" {
		return nil
	}
	return raw
}

// preview is mutate.ts's preview — synchronous (Adapter rule 3), no network call.
func preview(plan model.MutationPlan) ([]string, error) {
	bucket, err := resolveBucketSegment(plan.Path)
	if err != nil {
		return nil, err
	}
	out := make([]string, len(plan.Ops))
	for i, op := range plan.Ops {
		text, err := renderOpText(bucket, op)
		if err != nil {
			return nil, err
		}
		out[i] = text
	}
	return out, nil
}

func renderOpText(bucket string, op model.MutationRowOp) (string, error) {
	switch op.Kind {
	case "update":
		key, err := keyFrom(op.Key, "update")
		if err != nil {
			return "", err
		}
		value, err := adapters.ValueFrom(op.Changes, "update")
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("PutObject s3://%s/%s (%s)", bucket, key, formatBytes(int64(len(value)))), nil
	case "delete":
		key, err := keyFrom(op.Key, "delete")
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("DeleteObject s3://%s/%s", bucket, key), nil
	default: // insert
		key, err := keyFrom(op.Values, "insert")
		if err != nil {
			return "", err
		}
		file, err := fileFrom(op.Values)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("PutObject s3://%s/%s <- %s", bucket, key, file), nil
	}
}

// preservedAttributes is mutate.ts's preservedAttributes (P58d D13): carries over every attribute
// HeadObject returns and PutObject accepts. PutObject replaces an object wholesale, so anything
// not resent here is gone — silently turning application/json into binary/octet-stream, or
// dropping Content-Encoding: gzip, would change how the object is served to everything downstream.
//
// F5: also carries SSE (ServerSideEncryption/SSEKMSKeyId/BucketKeyEnabled — a real security
// downgrade left out: an SSE-KMS-encrypted object silently re-encrypted under the bucket default
// after any edit, no longer needing kms:Decrypt to read), Expires, WebsiteRedirectLocation, and the
// three object-lock fields, all confirmed present on both HeadObjectOutput and PutObjectInput.
// Tags are handled separately — see applyUpdate's own TagCount check — rather than here.
func applyPreservedAttributes(in *s3.PutObjectInput, head *s3.HeadObjectOutput) {
	if head.ContentType != nil {
		in.ContentType = head.ContentType
	}
	if head.CacheControl != nil {
		in.CacheControl = head.CacheControl
	}
	if head.ContentEncoding != nil {
		in.ContentEncoding = head.ContentEncoding
	}
	if head.ContentDisposition != nil {
		in.ContentDisposition = head.ContentDisposition
	}
	if head.ContentLanguage != nil {
		in.ContentLanguage = head.ContentLanguage
	}
	if head.StorageClass != "" {
		in.StorageClass = head.StorageClass
	}
	if head.Metadata != nil {
		in.Metadata = head.Metadata
	}
	if head.Expires != nil {
		in.Expires = head.Expires
	}
	if head.WebsiteRedirectLocation != nil {
		in.WebsiteRedirectLocation = head.WebsiteRedirectLocation
	}
	if head.ServerSideEncryption != "" {
		in.ServerSideEncryption = head.ServerSideEncryption
	}
	if head.SSEKMSKeyId != nil {
		in.SSEKMSKeyId = head.SSEKMSKeyId
	}
	if head.BucketKeyEnabled != nil {
		in.BucketKeyEnabled = head.BucketKeyEnabled
	}
	if head.ObjectLockMode != "" {
		in.ObjectLockMode = head.ObjectLockMode
	}
	if head.ObjectLockRetainUntilDate != nil {
		in.ObjectLockRetainUntilDate = head.ObjectLockRetainUntilDate
	}
	if head.ObjectLockLegalHoldStatus != "" {
		in.ObjectLockLegalHoldStatus = head.ObjectLockLegalHoldStatus
	}
}

// isConditionalPutUnsupported reports whether err is an S3-compatible endpoint's own signal that it
// doesn't honour IfMatch/IfNoneMatch on PutObject (F5) — real for some older S3-compatible object
// stores (pre-conditional-write MinIO/Ceph releases), which reject the header outright with
// NotImplemented rather than evaluating it.
func isConditionalPutUnsupported(err error) bool {
	var apiErr smithy.APIError
	if !errors.As(err, &apiErr) {
		return false
	}
	return apiErr.ErrorCode() == "NotImplemented"
}

// isPreconditionFailed reports whether err is S3's own 412 for a failed IfMatch/IfNoneMatch check.
func isPreconditionFailed(err error) bool {
	var apiErr smithy.APIError
	return errors.As(err, &apiErr) && apiErr.ErrorCode() == "PreconditionFailed"
}

func applyUpdate(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp, log func(level, message string)) (int, error) {
	key, err := keyFrom(op.Key, "update")
	if err != nil {
		return 0, err
	}
	value, err := adapters.ValueFrom(op.Changes, "update")
	if err != nil {
		return 0, err
	}
	head, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if err != nil {
		return 0, mapError(err)
	}
	// F5: this editor has no path to carry object tags across a PutObject replace (which drops
	// them outright) without a second GetObjectTagging/PutObjectTagging round trip — refusing the
	// edit is the more contained fix (over adding that second call's own surface) and never
	// silently drops data the user did not know was there.
	if head.TagCount != nil && *head.TagCount > 0 {
		return 0, adapters.New(adapters.CodeUnsupported,
			"this object has tags, which this editor does not preserve across an edit; remove its tags first, or edit it outside this app", nil)
	}
	in := &s3.PutObjectInput{
		Bucket: aws.String(bucket), Key: aws.String(key), Body: strings.NewReader(value),
		// F5: IfMatch closes the lost-update race — a concurrent writer's own change between this
		// HeadObject and the PutObject below is refused rather than silently overwritten.
		IfMatch: head.ETag,
	}
	applyPreservedAttributes(in, head)
	_, err = client.PutObject(ctx, in)
	if err == nil {
		return 1, nil
	}
	if isPreconditionFailed(err) {
		return 0, adapters.New(adapters.CodeQuery,
			"this object changed since it was loaded; reload and try again", nil)
	}
	if isConditionalPutUnsupported(err) {
		log("warn", "s3: endpoint rejected the conditional If-Match update; retrying unconditionally for s3://"+bucket+"/"+key)
		in.IfMatch = nil
		in.Body = strings.NewReader(value)
		if _, err := client.PutObject(ctx, in); err != nil {
			return 0, mapError(err)
		}
		return 1, nil
	}
	return 0, mapError(err)
}

func applyInsert(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp, log func(level, message string)) (int, error) {
	key, err := keyFrom(op.Values, "insert")
	if err != nil {
		return 0, err
	}
	sourcePath, err := fileFrom(op.Values)
	if err != nil {
		return 0, err
	}
	body, size, err := openUploadBody(sourcePath)
	if err != nil {
		return 0, err
	}
	defer body.Close()

	in := &s3.PutObjectInput{
		Bucket: aws.String(bucket), Key: aws.String(key), Body: body,
		ContentLength: aws.Int64(size), ContentType: contentTypeFrom(op.Values),
		// F5: PutObjectInput.IfNoneMatch("*") is a real conditional-create — it closes the
		// HeadObject-then-Put race the previous "HeadObject first, then Put" shape could not: two
		// concurrent inserts of the same key could both pass the HeadObject check before either
		// one's Put landed.
		IfNoneMatch: aws.String("*"),
	}
	_, err = client.PutObject(ctx, in)
	if err == nil {
		return 1, nil
	}
	if isPreconditionFailed(err) {
		return 0, adapters.New(adapters.CodeQuery, "key already exists: "+key, nil)
	}
	if !isConditionalPutUnsupported(err) {
		return 0, mapError(err)
	}
	// Fallback for an S3-compatible endpoint that rejects the conditional header outright: the
	// pre-F5 HeadObject-then-Put shape, logged so the safety check being skipped is visible.
	log("warn", "s3: endpoint rejected the conditional If-None-Match insert; falling back to a HeadObject-then-Put race for s3://"+bucket+"/"+key)
	_, headErr := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)})
	if headErr == nil {
		return 0, adapters.New(adapters.CodeQuery, "key already exists: "+key, nil)
	}
	var notFound *types.NotFound
	if !errors.As(headErr, &notFound) {
		return 0, mapError(headErr)
	}
	if _, err := body.Seek(0, 0); err != nil {
		return 0, adapters.New(adapters.CodeQuery, "could not rewind local file "+sourcePath+": "+err.Error(), err)
	}
	in.IfNoneMatch = nil
	if _, err := client.PutObject(ctx, in); err != nil {
		return 0, mapError(err)
	}
	return 1, nil
}

func applyDelete(ctx context.Context, client *s3.Client, bucket string, op model.MutationRowOp) (int, error) {
	key, err := keyFrom(op.Key, "delete")
	if err != nil {
		return 0, err
	}
	if _, err := client.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}); err != nil {
		return 0, mapError(err)
	}
	if _, err := client.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(bucket), Key: aws.String(key)}); err != nil {
		return 0, mapError(err)
	}
	return 1, nil
}

// mutate is mutate.ts's mutate.
func mutate(ctx context.Context, client *s3.Client, op *adapters.OpCtx, readOnly bool, plan model.MutationPlan, log func(level, message string)) (model.MutationResult, error) {
	if err := adapters.AssertWritable(readOnly); err != nil {
		return model.MutationResult{}, err
	}
	bucket, err := resolveBucketSegment(plan.Path)
	if err != nil {
		return model.MutationResult{}, err
	}
	statements, err := preview(plan)
	if err != nil {
		return model.MutationResult{}, err
	}

	return adapters.RunKindDispatched(ctx, op, plan, readOnly, statements, adapters.DispatchUpdateDeleteInsert(
		func(ctx context.Context, rowOp model.MutationRowOp) (int, error) {
			return applyUpdate(ctx, client, bucket, rowOp, log)
		},
		func(ctx context.Context, rowOp model.MutationRowOp) (int, error) {
			return applyDelete(ctx, client, bucket, rowOp)
		},
		func(ctx context.Context, rowOp model.MutationRowOp) (int, error) {
			return applyInsert(ctx, client, bucket, rowOp, log)
		},
	))
}
