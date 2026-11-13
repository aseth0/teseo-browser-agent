import { RECORDING_STATUS, type RecordingStatus } from '../recording/recorder-protocol';
import { useSessionValue } from './useSessionValue';

// The background's recording as it goes (recording/recorder): for the chat's review and the toolbar
// popup's Record line. None: nothing records or waits.
export const useRecordingStatus = () => useSessionValue<RecordingStatus>(RECORDING_STATUS);
