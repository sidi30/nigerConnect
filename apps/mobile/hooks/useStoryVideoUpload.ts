import { useCallback, useRef, useState } from 'react';
import {
  cancelPreparation,
  describeStoryVideoError,
  pickStoryVideo,
  prepareStoryVideo,
  uploadPreparedVideo,
  type PreparedStoryVideo,
  type UploadedStoryVideo,
} from '@/services/storyVideoService';
import type { UploadSource } from '@/services/uploadService';

export type StoryVideoPhase =
  | 'idle'
  | 'compressing'
  | 'ready'
  | 'uploading'
  | 'done'
  | 'error';

export interface StoryVideoState {
  phase: StoryVideoPhase;
  /** 0..1 progress of the CURRENT phase (compress or upload). */
  progress: number;
  prepared: PreparedStoryVideo | null;
  uploaded: UploadedStoryVideo | null;
  error: string | null;
}

const INITIAL: StoryVideoState = {
  phase: 'idle',
  progress: 0,
  prepared: null,
  uploaded: null,
  error: null,
};

/**
 * Drives the story-video composer: pick+compress → preview → upload, with
 * live progress, cancel (compression OR upload) and retry. Kept in a hook so
 * `stories/new.tsx` stays declarative and the flaky-4G handling lives in one place.
 */
export function useStoryVideoUpload() {
  const [state, setState] = useState<StoryVideoState>(INITIAL);
  const cancelIdRef = useRef<string | null>(null);
  const uploadTaskRef = useRef<{ cancel: () => void } | null>(null);
  const cancelledRef = useRef(false);
  const preparedRef = useRef<PreparedStoryVideo | null>(null);

  const reset = useCallback(() => {
    cancelledRef.current = false;
    cancelIdRef.current = null;
    uploadTaskRef.current = null;
    preparedRef.current = null;
    setState(INITIAL);
  }, []);

  const compress = useCallback(async (source: UploadSource) => {
    cancelledRef.current = false;
    preparedRef.current = null;
    setState({ phase: 'compressing', progress: 0, prepared: null, uploaded: null, error: null });
    try {
      const picked = await pickStoryVideo(source);
      if (!picked) {
        setState(INITIAL);
        return;
      }
      const prepared = await prepareStoryVideo(picked, {
        onProgress: (p) =>
          setState((s) => (s.phase === 'compressing' ? { ...s, progress: p } : s)),
        onCancelId: (id) => {
          cancelIdRef.current = id;
        },
      });
      if (cancelledRef.current) return;
      preparedRef.current = prepared;
      setState({ phase: 'ready', progress: 1, prepared, uploaded: null, error: null });
    } catch (err) {
      if (cancelledRef.current) return;
      setState({
        phase: 'error',
        progress: 0,
        prepared: null,
        uploaded: null,
        error: describeStoryVideoError(err),
      });
    }
  }, []);

  const upload = useCallback(async (): Promise<UploadedStoryVideo | null> => {
    const prepared = preparedRef.current;
    if (!prepared) return null;
    cancelledRef.current = false;
    setState((s) => ({ ...s, phase: 'uploading', progress: 0, error: null }));
    try {
      const uploaded = await uploadPreparedVideo(prepared, {
        onProgress: (p) =>
          setState((s) => (s.phase === 'uploading' ? { ...s, progress: p } : s)),
        onUploadTask: (t) => {
          uploadTaskRef.current = t;
        },
      });
      if (cancelledRef.current) return null;
      setState((s) => ({ ...s, phase: 'done', progress: 1, uploaded, error: null }));
      return uploaded;
    } catch (err) {
      if (cancelledRef.current) return null;
      setState((s) => ({ ...s, phase: 'error', error: describeStoryVideoError(err) }));
      return null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    if (cancelIdRef.current) {
      cancelPreparation(cancelIdRef.current);
      cancelIdRef.current = null;
    }
    if (uploadTaskRef.current) {
      uploadTaskRef.current.cancel();
      uploadTaskRef.current = null;
    }
    reset();
  }, [reset]);

  const retry = useCallback(
    (source: UploadSource): Promise<unknown> => {
      // A prepared clip means compression already succeeded — retry the upload;
      // otherwise the failure was during pick/compress, so start over.
      if (preparedRef.current) return upload();
      return compress(source);
    },
    [compress, upload],
  );

  return { state, compress, upload, cancel, retry, reset };
}
