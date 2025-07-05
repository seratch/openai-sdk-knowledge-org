import { IdUtils } from "../../pipeline/processors/id-utils";

describe("IdUtils", () => {
  describe("ensureSafeId", () => {
    it("should return short IDs unchanged", () => {
      const shortId = "github_issue_123";
      expect(IdUtils.ensureSafeId(shortId)).toBe(shortId);
    });

    it("should return IDs at exactly 64 bytes unchanged", () => {
      const exactId = "a".repeat(64);
      expect(IdUtils.ensureSafeId(exactId)).toBe(exactId);
      expect(IdUtils.ensureSafeId(exactId).length).toBe(64);
    });

    it("should truncate and hash IDs longer than 64 bytes", () => {
      const longId =
        "github_owner_repo_file_" + "very_long_path_name_".repeat(10);
      expect(longId.length).toBeGreaterThan(64);

      const safeId = IdUtils.ensureSafeId(longId);
      expect(safeId.length).toBeLessThanOrEqual(64);
      expect(safeId).toContain("_");
      expect(safeId).toMatch(/^github_owner_repo_file_.*_[0-9a-f]{8}$/);
    });

    it("should generate consistent hashes for the same input", () => {
      const longId = "github_file_" + "x".repeat(100);
      const safeId1 = IdUtils.ensureSafeId(longId);
      const safeId2 = IdUtils.ensureSafeId(longId);
      expect(safeId1).toBe(safeId2);
    });

    it("should generate different hashes for different inputs", () => {
      const longId1 = "github_file_" + "x".repeat(100);
      const longId2 = "github_file_" + "y".repeat(100);
      const safeId1 = IdUtils.ensureSafeId(longId1);
      const safeId2 = IdUtils.ensureSafeId(longId2);
      expect(safeId1).not.toBe(safeId2);
    });

    it("should handle the original error case", () => {
      const problematicId =
        "github_file_src/very/long/path/to/some/file/that/exceeds/the/limit.ts";
      expect(problematicId.length).toBeGreaterThan(64);

      const safeId = IdUtils.ensureSafeId(problematicId);
      expect(safeId.length).toBeLessThanOrEqual(64);
      expect(safeId).toContain(
        "github_file_src/very/long/path/to/some/file/that/exceed",
      );
      expect(safeId).toMatch(/_[0-9a-f]{8}$/);
    });
  });
});
