# RAG Upload Fix Summary

## Problem

Four specific files were consistently failing to upload to the RAG cache:
1. `183 Japan Defense of Japan 2021.txt`
2. `341 St Kitts and Nevis National Security Strategy 2021.txt`
3. `39 Belgium The Strategic Vision for Defence 2030 (2016).txt`
4. `578 Japan Defence of Japan 2016.txt`

## Root Cause Analysis

After analyzing the existing retry scripts and upload behavior, the issues were identified:

1. **Insufficient Upload Timeout**
   - Original: 60 poll attempts × 3s = 180 seconds (3 minutes)
   - Problem: These files need longer processing time for embedding generation

2. **Inadequate Rate Limiting Protection**
   - Original: 500ms delay between uploads
   - Problem: Gemini API may rate-limit aggressive upload patterns

3. **Limited Retry Attempts**
   - Original: 3 retries with 1-second base delay
   - Problem: Not enough attempts for transient network/API issues

## Solution Implemented

Updated `server/src/geminiService.ts` - `uploadFileToRagStore()` function with:

### Changes Made:

1. **Extended Timeout** (line 174)
   - Changed from: `60 poll attempts` (3 minutes)
   - Changed to: `120 poll attempts` (6 minutes)
   - Allows more time for large files to process

2. **Increased Retry Attempts** (line 156)
   - Changed from: `3 retries`
   - Changed to: `5 retries`
   - Better handling of transient failures

3. **Improved Retry Delay** (line 157)
   - Changed from: `1000ms` base delay
   - Changed to: `2000ms` base delay
   - Exponential backoff: 2s → 4s → 8s → 16s → 32s

4. **Enhanced Rate Limiting** (line 192)
   - Changed from: `500ms` post-upload delay
   - Changed to: `1500ms` post-upload delay
   - Reduces risk of API rate limiting

5. **Progress Logging** (lines 185-188)
   - Added: Progress indicator every minute for long uploads
   - Provides visibility into processing status

## Expected Outcome

With these changes:
- ✅ Longer processing time allowed (3 min → 6 min)
- ✅ More retry attempts (3 → 5)
- ✅ Better spacing between retries (1s → 2s base)
- ✅ Reduced rate limiting risk (500ms → 1500ms)
- ✅ Better observability with progress logging

## How to Test

1. Clear the existing RAG store or use force reload
2. Run the upload process
3. Monitor the console for the four previously-failing files
4. Verify all 607 documents upload successfully

## Rollback Plan

If issues occur, revert the changes in `server/src/geminiService.ts:152-208` to restore original values:
- `maxRetries = 3`
- `baseDelay = 1000`
- `maxPollAttempts = 60`
- Post-upload delay = `500`

## Related Files

- **Main fix**: `server/src/geminiService.ts`
- **Diagnostic scripts**:
  - `server/diagnose-failed-files.js`
  - `server/retry-failed-files.js`
  - `server/retry-with-delays.js`

## Future Improvements

Consider:
1. Adaptive timeout based on file size
2. Per-file retry tracking in database
3. Automatic resume on partial upload failure
4. File size validation before upload
5. Chunked upload for very large files
