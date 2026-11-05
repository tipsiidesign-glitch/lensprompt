import { expect, test } from "bun:test";
import { isSendingVideo, isValidSession, isVideoLive } from "../src/lib/pairing";

const playing = { trackState: "live", muted: false, videoWidth: 1280, paused: false };

test("desktop shows live only when the remote track is live, unmuted and playing", () => {
  expect(isVideoLive(playing)).toBe(true);
  expect(isVideoLive({ ...playing, muted: true })).toBe(false);
  expect(isVideoLive({ ...playing, trackState: "ended" })).toBe(false);
  expect(isVideoLive({ ...playing, videoWidth: 0 })).toBe(false);
  expect(isVideoLive({ ...playing, paused: true })).toBe(false);
  expect(isVideoLive({ ...playing, trackState: undefined })).toBe(false);
});

test("phone shows live only when video bytes keep increasing", () => {
  expect(isSendingVideo(1000, 5000)).toBe(true);
  expect(isSendingVideo(5000, 5000)).toBe(false);
  expect(isSendingVideo(0, 0)).toBe(false);
});

test("pairing links with missing or tampered sessions are rejected", () => {
  expect(isValidSession("")).toBe(false);
  expect(isValidSession("short")).toBe(false);
  expect(isValidSession("abc def ghi jkl")).toBe(false);
  expect(isValidSession("ABCDEFGHIJKL")).toBe(false);
  expect(isValidSession("abcdefghijkl")).toBe(true);
});
