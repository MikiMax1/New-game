using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using UnityEditor;
using UnityEngine;
using UnityEngine.Networking;

namespace Solmar.EditorTools
{
    /// <summary>
    /// Keeps Assets/Solmar up to date with the game's code on GitHub, so a project the folder was
    /// copied into picks up new work by itself.
    ///
    /// When the Editor starts, and every two minutes while it is open (not in Play mode), it asks
    /// GitHub for the latest commit on the branch. If that differs from the last one installed, it
    /// downloads the branch, replaces the code under Assets/Solmar (Editor, Runtime and the files
    /// at the top), removes files that were deleted upstream, and reimports. Assets/Solmar/Scenes
    /// is left alone, so the saved street scene survives. The city rebuilds itself with the new
    /// code when the scripts reload.
    ///
    /// Solmar > Auto Update turns this on and off; Solmar > Update Now checks at once. In the Git
    /// checkout of the repository itself it is off, so it never overwrites work in progress.
    ///
    /// The repository is private, so GitHub answers "not found" without a token. Solmar > Set
    /// GitHub Token... stores a fine-grained, read-only token (Contents: read on this repository)
    /// in this computer's Editor preferences, and every request sends it.
    /// </summary>
    [InitializeOnLoad]
    public static class SolmarUpdater
    {
        const string Repo = "MikiMax1/New-game";
        const string Branch = "claude/kind-davinci-tom9fp";
        const string SourceFolder = "unity/Assets/Solmar/";
        const string TargetFolder = "Assets/Solmar";
        const double CheckInterval = 120;
        const string AutoMenu = "Solmar/Auto Update";

        const string TokenKey = "Solmar.Updater.Token";

        static double nextCheck;
        static bool busy;
        static bool warned;

        static string Token => EditorPrefs.GetString(TokenKey, "").Trim();

        static string ProjectRoot => Path.GetDirectoryName(Application.dataPath);
        static string Key(string name) => "Solmar.Updater." + name + "." + ProjectRoot;

        /// <summary>True in the repository's own checkout (a .git folder above the project).</summary>
        static bool IsSourceCheckout => Directory.Exists(Path.Combine(ProjectRoot, "..", ".git")) || Directory.Exists(Path.Combine(ProjectRoot, ".git"));

        static bool AutoUpdate
        {
            get => EditorPrefs.GetBool(Key("Auto"), !IsSourceCheckout);
            set => EditorPrefs.SetBool(Key("Auto"), value);
        }

        static SolmarUpdater()
        {
            nextCheck = EditorApplication.timeSinceStartup + 5;
            EditorApplication.update += Tick;
            EditorApplication.delayCall += () => Menu.SetChecked(AutoMenu, AutoUpdate);
        }

        static void Tick()
        {
            if (busy || !AutoUpdate || EditorApplication.timeSinceStartup < nextCheck) return;
            if (EditorApplication.isPlayingOrWillChangePlaymode || EditorApplication.isCompiling) return;
            nextCheck = EditorApplication.timeSinceStartup + CheckInterval;
            Check(false);
        }

        [MenuItem(AutoMenu, priority = 20)]
        static void ToggleAuto()
        {
            AutoUpdate = !AutoUpdate;
            Menu.SetChecked(AutoMenu, AutoUpdate);
            Debug.Log("Solmar: automatic updates " + (AutoUpdate ? "on." : "off."));
        }

        [MenuItem("Solmar/Update Now", priority = 21)]
        static void UpdateNow()
        {
            if (IsSourceCheckout && !EditorUtility.DisplayDialog("Solmar", "This is the repository's own Git checkout. Updating replaces Assets/Solmar with the version on GitHub. Continue?", "Update", "Cancel")) return;
            Check(true);
        }

        [MenuItem("Solmar/Set GitHub Token...", priority = 22)]
        static void SetToken() => TokenWindow.Open();

        [MenuItem("Solmar/Clear GitHub Token", priority = 23)]
        static void ClearToken()
        {
            EditorPrefs.DeleteKey(TokenKey);
            Debug.Log("Solmar: GitHub token removed.");
        }

        /// <summary>A small window to paste the token into (Unity has no text-input dialog).</summary>
        sealed class TokenWindow : EditorWindow
        {
            string token = "";

            public static void Open()
            {
                var window = GetWindow<TokenWindow>(true, "Solmar: GitHub token", true);
                window.minSize = window.maxSize = new Vector2(460f, 150f);
                window.token = Token;
            }

            void OnGUI()
            {
                EditorGUILayout.HelpBox("The game's repository is private, so updates need a GitHub token. On GitHub: Settings > Developer settings > Fine-grained tokens > Generate, repository MikiMax1/New-game, permission Contents: Read-only. Paste it here. It is kept only in this computer's Unity preferences.", MessageType.Info);
                token = EditorGUILayout.PasswordField("Token", token);
                GUILayout.FlexibleSpace();
                using (new EditorGUILayout.HorizontalScope())
                {
                    GUILayout.FlexibleSpace();
                    if (GUILayout.Button("Cancel", GUILayout.Width(90f))) Close();
                    if (GUILayout.Button("Save and update", GUILayout.Width(130f)))
                    {
                        EditorPrefs.SetString(TokenKey, token.Trim());
                        warned = false;
                        Close();
                        if (!IsSourceCheckout) Check(true);
                    }
                }
            }
        }

        [Serializable]
        class CommitInfo
        {
            public string sha = "";
        }

        static UnityWebRequest Get(string url)
        {
            var request = UnityWebRequest.Get(url);
            request.SetRequestHeader("User-Agent", "Solmar-Unity-Updater");
            if (Token.Length > 0) request.SetRequestHeader("Authorization", "Bearer " + Token);
            return request;
        }

        static void Check(bool verbose)
        {
            busy = true;
            UnityWebRequest request = Get("https://api.github.com/repos/" + Repo + "/commits/" + Uri.EscapeDataString(Branch));
            request.SetRequestHeader("Accept", "application/vnd.github+json");
            request.SendWebRequest().completed += _ =>
            {
                try
                {
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        // Say why once per Editor session for automatic checks, every time when asked.
                        if (verbose || !warned) Debug.LogWarning("Solmar: couldn't check GitHub for updates (" + request.error + "). " + Advice(request.responseCode));
                        warned = true;
                        busy = false;
                        return;
                    }
                    string sha = JsonUtility.FromJson<CommitInfo>(request.downloadHandler.text)?.sha;
                    if (string.IsNullOrEmpty(sha) || sha == EditorPrefs.GetString(Key("Sha"), ""))
                    {
                        if (verbose) Debug.Log("Solmar: already up to date.");
                        busy = false;
                        return;
                    }
                    Download(sha);
                }
                finally
                {
                    request.Dispose();
                }
            };
        }

        static void Download(string sha)
        {
            Debug.Log("Solmar: downloading update " + sha.Substring(0, 7) + "...");
            // With a token the API's zipball works for a private repository (it redirects to a
            // signed download); without one, codeload only serves public repositories.
            UnityWebRequest request = Get(Token.Length > 0
                ? "https://api.github.com/repos/" + Repo + "/zipball/" + sha
                : "https://codeload.github.com/" + Repo + "/zip/" + sha);
            request.SendWebRequest().completed += _ =>
            {
                try
                {
                    if (request.result != UnityWebRequest.Result.Success)
                    {
                        Debug.LogWarning("Solmar: update download failed (" + request.error + "). " + Advice(request.responseCode));
                        return;
                    }
                    int changed = Install(request.downloadHandler.data);
                    EditorPrefs.SetString(Key("Sha"), sha);
                    Debug.Log("Solmar: updated to " + sha.Substring(0, 7) + " (" + changed + " files changed).");
                    if (changed > 0) AssetDatabase.Refresh();
                }
                catch (Exception e)
                {
                    Debug.LogError("Solmar: update failed: " + e.Message);
                }
                finally
                {
                    request.Dispose();
                    busy = false;
                }
            };
        }

        /// <summary>The likely cause of a failed request, from its HTTP status.</summary>
        static string Advice(long status)
        {
            if (status == 404 || status == 401)
            {
                return Token.Length == 0
                    ? "The repository is private: choose Solmar > Set GitHub Token... and paste a read-only token for " + Repo + "."
                    : "GitHub refused the saved token: check it hasn't expired and has Contents: Read on " + Repo + ", then set it again with Solmar > Set GitHub Token....";
            }
            if (status == 403 || status == 429) return "GitHub's rate limit was hit; it will try again in a few minutes.";
            if (status == 0) return "Check the internet connection.";
            return "It will try again in a couple of minutes.";
        }

        /// <summary>Writes the zip's Solmar files into Assets/Solmar; returns how many changed.</summary>
        static int Install(byte[] zip)
        {
            string target = Path.Combine(ProjectRoot, TargetFolder);
            var wanted = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            int changed = 0;
            using (var archive = new ZipArchive(new MemoryStream(zip), ZipArchiveMode.Read))
            {
                foreach (ZipArchiveEntry entry in archive.Entries)
                {
                    // Entries are "<repo>-<sha>/unity/Assets/Solmar/...".
                    int slash = entry.FullName.IndexOf('/');
                    if (slash < 0) continue;
                    string path = entry.FullName.Substring(slash + 1);
                    if (!path.StartsWith(SourceFolder, StringComparison.Ordinal) || path.EndsWith("/")) continue;
                    string relative = path.Substring(SourceFolder.Length);
                    if (relative.StartsWith("Scenes/", StringComparison.Ordinal)) continue;
                    string file = Path.GetFullPath(Path.Combine(target, relative));
                    if (!file.StartsWith(Path.GetFullPath(target), StringComparison.Ordinal)) continue;
                    wanted.Add(file);

                    byte[] data;
                    using (Stream s = entry.Open())
                    using (var buffer = new MemoryStream())
                    {
                        s.CopyTo(buffer);
                        data = buffer.ToArray();
                    }
                    if (File.Exists(file) && Same(File.ReadAllBytes(file), data)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(file));
                    File.WriteAllBytes(file, data);
                    changed++;
                }
            }
            if (wanted.Count == 0) throw new InvalidOperationException("the download had no " + SourceFolder + " folder");

            // Remove code deleted upstream (and its .meta), outside Scenes.
            foreach (string folder in new[] { "Editor", "Runtime" })
            {
                string dir = Path.Combine(target, folder);
                if (!Directory.Exists(dir)) continue;
                foreach (string file in Directory.GetFiles(dir, "*", SearchOption.AllDirectories))
                {
                    if (file.EndsWith(".meta", StringComparison.OrdinalIgnoreCase)) continue;
                    if (wanted.Contains(Path.GetFullPath(file))) continue;
                    File.Delete(file);
                    if (File.Exists(file + ".meta")) File.Delete(file + ".meta");
                    changed++;
                }
            }
            return changed;
        }

        static bool Same(byte[] a, byte[] b)
        {
            if (a.Length != b.Length) return false;
            for (int i = 0; i < a.Length; i++)
            {
                if (a[i] != b[i]) return false;
            }
            return true;
        }
    }
}
