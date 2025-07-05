export class IdUtils {
  private static readonly MAX_ID_LENGTH = 64;
  private static readonly HASH_LENGTH = 8;

  static ensureSafeId(proposedId: string): string {
    if (proposedId.length <= this.MAX_ID_LENGTH) {
      return proposedId;
    }

    const maxPrefixLength = this.MAX_ID_LENGTH - this.HASH_LENGTH - 1;
    const prefix = proposedId.substring(0, maxPrefixLength);
    const hash = this.generateHash(proposedId);

    return `${prefix}_${hash}`;
  }

  private static generateHash(input: string): string {
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(8, "0");
  }
}
