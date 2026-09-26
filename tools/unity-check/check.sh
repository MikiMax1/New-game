#!/usr/bin/env bash
# Checks the Unity project without Unity: type-checks its C# against Unity 6.0's C# reference
# source and HDRP 17.0's source (see Program.cs), for the editor and for player builds, and
# compiles every compute shader kernel as HLSL with glslang.
#
# Usage: tools/unity-check/check.sh [cache dir, default .cache/unity-check]
# Needs: git, curl, unzip, the .NET 8 SDK, glslangValidator. The first run downloads about 120 MB.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
cache="$(mkdir -p "${1:-$repo/.cache/unity-check}" && cd "${1:-$repo/.cache/unity-check}" && pwd)"

# Only the paths needed, at pinned commits so the check doesn't change under us.
sparse_fetch() { # url commit dir patterns...
  local url=$1 commit=$2 dir=$cache/$3
  shift 3
  if [ "$(git -C "$dir" rev-parse -q --verify HEAD 2>/dev/null || true)" != "$commit" ]; then
    rm -rf "$dir"
    git init -q "$dir"
    git -C "$dir" remote add origin "$url"
    git -C "$dir" sparse-checkout set --no-cone "$@"
    git -C "$dir" fetch -q --depth 1 --filter=blob:none origin "$commit"
    git -C "$dir" checkout -q FETCH_HEAD
  fi
}
# HDRP 17.0 (branch 6000.0/staging) and Unity 6.0's C# reference source (branch 6000.0).
sparse_fetch https://github.com/Unity-Technologies/Graphics.git feb4de2d9a93a4ae10d287d3a6d7003d08ea3e53 graphics \
  '/Packages/com.unity.render-pipelines.core/Runtime/' \
  '/Packages/com.unity.render-pipelines.high-definition/Runtime/' \
  '/Packages/com.unity.render-pipelines.high-definition-config/Runtime/'
sparse_fetch https://github.com/Unity-Technologies/UnityCsReference.git 0c7f0bfc4f9b21d3d84fffc9ee9001ad82f0fbc4 csref \
  '/Runtime/**/*.cs' '/Modules/**/*.cs' '/Editor/Mono/**/*.cs'

# .NET Standard 2.1 reference assemblies (Unity's default API level).
if [ ! -d "$cache/refs/nsref" ]; then
  mkdir -p "$cache/refs"
  curl -sSfL -o "$cache/refs/nsref.nupkg" https://api.nuget.org/v3-flatcontainer/netstandard.library.ref/2.1.0/netstandard.library.ref.2.1.0.nupkg
  unzip -q -o "$cache/refs/nsref.nupkg" 'ref/netstandard2.1/*' -d "$cache/refs/nsref"
fi

status=0
dotnet build -c Release -v q --nologo "$here/UnityCheck.csproj" > /dev/null
for mode in editor player; do
  dotnet "$here/bin/Release/net8.0/UnityCheck.dll" "$cache" "$repo/unity" "$mode" || status=1
done

for shader in $(find "$repo/unity/Assets" -name '*.compute'); do
  for kernel in $(sed -n 's/^#pragma kernel \([A-Za-z0-9_]*\).*/\1/p' "$shader"); do
    if glslangValidator -D -V -S comp -e "$kernel" "$shader" -o /dev/null > "$cache/glslang.txt" 2>&1; then
      echo "${shader#$repo/} $kernel: ok"
    else
      echo "${shader#$repo/} $kernel: failed"; sed 1d "$cache/glslang.txt"; status=1
    fi
  done
done
exit $status
