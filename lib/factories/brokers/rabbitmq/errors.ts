/** True for the broker's 404 NOT_FOUND channel error (a missing exchange or queue). */
export function isNotFound(err: any): boolean {
    return err?.code === 404 || /NOT_FOUND/.test(String(err?.message));
}
