import { state, head, card, notice, toast } from "./core.js";
export function storage(root) {
  root.innerHTML =
    head(
      "Storage & recovery",
      "Export your organization’s linked records and original media.",
    ) +
    card(
      "Complete organization backup",
      `<p>The archive contains private client records, analyses, coordinates, scans, notes, programs and uploaded media. Keep it in storage controlled by your studio. Login sessions and passwords are excluded.</p><a class="button primary" href="/platform/backup" download="motion-yoga-backup.zip">Download organization backup</a>`,
    ) +
    card(
      "Restore a studio",
      `<p>Restore into a new, empty studio. All relationships are rebuilt with new IDs. Your current administrator login remains active; set new passwords for restored accounts in Clients and Coaches.</p>${notice("Existing client data is never replaced. To recover after a storage reset, create a studio, then upload its saved archive here.")}<label class="file-button">Choose organization backup<input id="backup-file" type="file" accept=".zip,application/zip"></label><button id="restore" class="primary">Restore selected backup</button><p id="restore-status" role="status"></p>`,
    );
  root.querySelector("#restore").onclick = async () => {
    const file = root.querySelector("#backup-file").files[0],
      button = root.querySelector("#restore"),
      status = root.querySelector("#restore-status");
    if (!file) {
      status.textContent = "Choose a backup file first.";
      return;
    }
    button.disabled = true;
    status.textContent = "Uploading and validating the organization archive…";
    try {
      const response = await fetch("/platform/restore", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "X-Platform-Request": "1",
        },
        credentials: "same-origin",
        body: file,
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Error(
          "The server returned an incomplete response. Sign in and check the studio before retrying.",
        );
      }
      if (!response.ok) throw Error(data.error || "Restore failed.");
      status.textContent = `Restored ${data.restored_records} records and ${data.media_files} media files. ${data.message}`;
      toast("Studio restored");
      window.dispatchEvent(new Event("platform-refresh"));
    } catch (e) {
      status.textContent = e.message;
    } finally {
      button.disabled = false;
    }
  };
}
