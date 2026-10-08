"""P218 step 1 fixture prep. Run: python3 -I prepare.py <jfk.wav> <kokoro-dir>
Needs a venv with: pip install sherpa-onnx soundfile pyarrow numpy scipy
Writes audio and refs.json under $KIRA_STT_BENCH_DIR (never into git)."""
import io
import json
import os
import shutil
import sys
import urllib.request

import numpy as np
import pyarrow.parquet as pq
import sherpa_onnx
import soundfile as sf
from scipy.signal import resample_poly

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ["KIRA_STT_BENCH_DIR"]
JFK, KOKORO = sys.argv[1], sys.argv[2]
LIBRI = "https://huggingface.co/datasets/hf-internal-testing/librispeech_asr_dummy/resolve/5be91486e11a2d616f4ec5db8d3fd248585ac07a/clean/validation-00000-of-00001.parquet"
C1 = "https://huggingface.co/csukuangfj/sherpa-onnx-whisper-small.en/resolve/d9533f69affd85061aee349af7fea5cb2996dbbe/"
SR = 16000


def fetch(url):
    return urllib.request.urlopen(url).read()


def write16(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path, np.clip(x, -1, 1), SR, subtype="PCM_16")


def mono16k(x, sr):
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != SR:
        x = resample_poly(x, SR, sr)
    return x.astype(np.float32)


def trim(x, pad_ms=100):
    n = SR // 100
    env = np.array([np.abs(x[i : i + n]).max() for i in range(0, len(x), n)])
    idx = np.nonzero(env > 0.01)[0]
    if len(idx) == 0:
        return x
    pad = pad_ms // 10
    return x[max(0, idx[0] - pad) * n : (idx[-1] + 1 + pad) * n]


refs = {"f2": [], "f3": [], "f4": [], "f5": None}

os.makedirs(f"{OUT}/f1", exist_ok=True)
shutil.copy(JFK, f"{OUT}/f1/jfk.wav")

trans = dict(l.split(" ", 1) for l in fetch(C1 + "test_wavs/trans.txt").decode().splitlines() if " " in l)
for i, name in enumerate(["0.wav", "1.wav"]):
    p = f"{OUT}/f2/{name}"
    os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, "wb").write(fetch(C1 + "test_wavs/" + name))
    x, sr = sf.read(p, dtype="float32")
    write16(p, mono16k(x, sr))
    refs["f2"].append({"file": f"f2/{name}", "ref": trans[name].strip()})

tbl = pq.read_table(io.BytesIO(fetch(LIBRI))).to_pylist()[:30]
utts = []
for i, r in enumerate(tbl):
    x, sr = sf.read(io.BytesIO(r["audio"]["bytes"]), dtype="float32")
    x = mono16k(x, sr)
    write16(f"{OUT}/f3/{i:02d}.wav", x)
    refs["f3"].append({"file": f"f3/{i:02d}.wav", "ref": r["text"].strip()})
    utts.append((x, r["text"].strip()))

parts, texts, total = [], [], 0
for x, t in utts:
    x = trim(x)
    parts.append(x)
    texts.append(t)
    total += len(x)
    if total >= 60 * SR:
        break
write16(f"{OUT}/f5/f5.wav", np.concatenate(parts))
refs["f5"] = {"file": "f5/f5.wav", "ref": " ".join(texts)}

tts = sherpa_onnx.OfflineTts(
    sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
                model=f"{KOKORO}/model.onnx",
                voices=f"{KOKORO}/voices.bin",
                tokens=f"{KOKORO}/tokens.txt",
                data_dir=f"{KOKORO}/espeak-ng-data",
            ),
            num_threads=2,
        )
    )
)
f4 = json.load(open(f"{HERE}/f4.json"))
silence = np.zeros(int(0.3 * SR), dtype=np.float32)
for i, s in enumerate(f4["sentences"]):
    g = tts.generate(s["say"], sid=[5, 1][i % 2], speed=1.0)
    x = mono16k(np.array(g.samples, dtype=np.float32), g.sample_rate)
    write16(f"{OUT}/f4/{i:02d}.wav", np.concatenate([silence, x, silence]))
    refs["f4"].append({"file": f"f4/{i:02d}.wav", "ref": s["ref"]})
refs["terms"] = f4["terms"]
json.dump(refs, open(f"{OUT}/refs.json", "w"), indent=1)
print("ok", {k: (len(v) if isinstance(v, list) else 1) for k, v in refs.items()})
