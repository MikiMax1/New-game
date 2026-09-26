// Type-checks the Unity project's scripts without a Unity install, as three compilations:
//
//   engine   Unity 6.0's C# reference source (UnityEngine and UnityEditor)
//   srp      Core RP, HDRP and HDRP config runtime source (HDRP 17.0)
//   project  Assets/Solmar Runtime (and Editor), referencing the two above
//
// The engine and srp compilations have errors of their own (native bindings, Burst and other
// packages they need aren't here); only their declarations matter. Referencing them as separate
// compilations keeps their internal members inaccessible, as in Unity. The project compiles at
// C# 9, Unity's language version, with the editor's defines, or a player build's with "player".
//
// Usage: dotnet run -- <cache dir> <unity project dir> [editor|player]
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

string cache = args[0];
string project = args[1];
bool player = args.Length > 2 && args[2] == "player";

var defines = new List<string>
{
    "UNITY_6000_0", "UNITY_6000", "UNITY_64", "PLATFORM_ARCH_64", "UNITY_STANDALONE_WIN", "UNITY_STANDALONE",
    "UNITY_2019_4_OR_NEWER", "UNITY_2020_1_OR_NEWER", "UNITY_2020_2_OR_NEWER", "UNITY_2020_3_OR_NEWER",
    "UNITY_2021_1_OR_NEWER", "UNITY_2021_2_OR_NEWER", "UNITY_2021_3_OR_NEWER",
    "UNITY_2022_1_OR_NEWER", "UNITY_2022_2_OR_NEWER", "UNITY_2022_3_OR_NEWER",
    "UNITY_2023_1_OR_NEWER", "UNITY_2023_2_OR_NEWER", "UNITY_2023_3_OR_NEWER", "UNITY_6000_0_OR_NEWER",
    "ENABLE_MONO", "ENABLE_VR", "ENABLE_XR_MODULE", "ENABLE_LEGACY_INPUT_MANAGER", "ENABLE_VIRTUALTEXTURES",
    "NET_STANDARD_2_0", "NET_STANDARD_2_1", "NET_STANDARD", "NETSTANDARD", "NETSTANDARD2_1",
};
if (!player) defines.Add("UNITY_EDITOR");

var parse = new CSharpParseOptions(LanguageVersion.CSharp9, preprocessorSymbols: defines);
var options = new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary, allowUnsafe: true);

IEnumerable<SyntaxTree> Parse(IEnumerable<string> files) =>
    files.Select(f => CSharpSyntaxTree.ParseText(File.ReadAllText(f), parse, f));

IEnumerable<string> Sources(string root, IEnumerable<string> dirs) =>
    dirs.SelectMany(d => Directory.GetFiles(Path.Combine(root, d), "*.cs", SearchOption.AllDirectories));

var std = Directory.GetFiles(Path.Combine(cache, "refs/nsref/ref/netstandard2.1"), "*.dll")
    .Select(f => (MetadataReference)MetadataReference.CreateFromFile(f)).ToList();

var engineFiles = Sources(Path.Combine(cache, "csref"), player ? new[] { "Runtime", "Modules" } : new[] { "Runtime", "Modules", "Editor/Mono" })
    .Where(f => !player || !f.Contains("/Editor/"));
var engine = CSharpCompilation.Create("UnityEngine", Parse(engineFiles), std, options);

var srpFiles = Sources(Path.Combine(cache, "graphics/Packages"), new[]
{
    "com.unity.render-pipelines.core/Runtime",
    "com.unity.render-pipelines.high-definition/Runtime",
    "com.unity.render-pipelines.high-definition-config/Runtime",
});
var srp = CSharpCompilation.Create("Unity.RenderPipelines", Parse(srpFiles), std.Append(engine.ToMetadataReference()), options);

string assets = Path.Combine(project, "Assets/Solmar");
var refs = std.Concat(new[] { engine.ToMetadataReference(), srp.ToMetadataReference() }).ToList();
var runtime = CSharpCompilation.Create("Solmar.Runtime", Parse(Sources(assets, new[] { "Runtime" })), refs, options);
int errors = Report(runtime);
if (!player)
{
    var editor = CSharpCompilation.Create("Solmar.Editor", Parse(Sources(assets, new[] { "Editor" })), refs.Append(runtime.ToMetadataReference()), options);
    errors += Report(editor);
}
return errors > 0 ? 1 : 0;

int Report(CSharpCompilation c)
{
    var ignore = new HashSet<string> { "CS1701", "CS1702", "CS1705" };
    var diagnostics = c.GetDiagnostics()
        .Where(d => d.Severity >= DiagnosticSeverity.Warning && !ignore.Contains(d.Id))
        .OrderBy(d => d.Location.SourceTree?.FilePath).ThenBy(d => d.Location.SourceSpan.Start).ToList();
    int count = diagnostics.Count(d => d.Severity == DiagnosticSeverity.Error);
    Console.WriteLine($"{c.AssemblyName} ({(player ? "player" : "editor")}): {c.SyntaxTrees.Count()} files, {count} errors, {diagnostics.Count - count} warnings");
    foreach (var d in diagnostics)
    {
        var span = d.Location.GetLineSpan();
        Console.WriteLine($"  {Path.GetRelativePath(project, span.Path)}:{span.StartLinePosition.Line + 1}:{span.StartLinePosition.Character + 1} {d.Severity.ToString().ToLowerInvariant()} {d.Id}: {d.GetMessage()}");
    }
    return count;
}
