"""
cllg_export.py — standalone md2tei converter.

Stdlib + pyyaml only. lxml is optional (used for RNG validation if present).
"""

import os
import re
import argparse
import unicodedata
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape
from dataclasses import dataclass
from typing import List, Optional, Tuple, Any
import yaml

try:
    from lxml import etree as _lxml_etree
    _HAS_LXML = True
except ImportError:
    _HAS_LXML = False

# ── Constants ─────────────────────────────────────────────────────────────────

NS = "http://www.tei-c.org/ns/1.0"
ET.register_namespace("", NS)

DEFAULT_RNG = Path(__file__).parent / "tei_all.rng"

FORMAT_MAP = {
    "Roman": r"^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[XV]|V?I{0,3})$"
}

# ── Level dataclass ───────────────────────────────────────────────────────────

@dataclass
class Level:
    depth: int
    name: str
    style: str
    format_regex: str
    missing_first: bool
    is_milestone: bool

# ── FormatParser ──────────────────────────────────────────────────────────────

class FormatParser:
    """Handles parsing strings into sequential integers based on their style."""

    greek_val_map = {
        'α': 1, 'β': 2, 'γ': 3, 'δ': 4, 'ε': 5, 'ϛ': 6, 'ζ': 7, 'η': 8, 'θ': 9,
        'ι': 10, 'κ': 20, 'λ': 30, 'μ': 40, 'ν': 50, 'ξ': 60, 'ο': 70, 'π': 80, 'ϟ': 90,
        'ρ': 100, 'σ': 200, 'τ': 300, 'υ': 400, 'φ': 500, 'χ': 600, 'ψ': 700, 'ω': 800, 'ϡ': 900
    }

    roman_map = {'i': 1, 'v': 5, 'x': 10, 'l': 50, 'c': 100, 'd': 500, 'm': 1000}

    @staticmethod
    def parse_roman(text: str) -> int:
        total, prev_val = 0, 0
        for char in reversed(text.lower()):
            val = FormatParser.roman_map.get(char, 0)
            if val < prev_val:
                total -= val
            else:
                total += val
                prev_val = val
        return total

    @staticmethod
    def parse_greek(text: str) -> int:
        total = 0
        text = text.lower().replace('ʹ', '').strip()
        i = 0
        while i < len(text):
            char = text[i]
            if char == '͵':
                i += 1
                if i < len(text) and text[i] in FormatParser.greek_val_map:
                    total += FormatParser.greek_val_map[text[i]] * 1000
            elif char in FormatParser.greek_val_map:
                total += FormatParser.greek_val_map[char]
            i += 1
        return total if total > 0 else -1

    @staticmethod
    def parse_alpha(text: str) -> int:
        num = 0
        for char in text.lower():
            if 'a' <= char <= 'z':
                num = num * 26 + (ord(char) - ord('a') + 1)
        return num

    @staticmethod
    def parse_stephanus(text: str) -> int:
        m = re.match(r'^(\d+)([a-e])$', text.lower())
        if m:
            return (int(m.group(1)) * 5) + (ord(m.group(2)) - ord('a') + 1)
        return -1

    @staticmethod
    def get_start_value(style: str) -> int:
        style = style.lower()
        if style in ["stephanus", r"\d+[a-e]"]:
            return 6
        return 1

    @staticmethod
    def parse(style: str, text: str) -> Optional[int]:
        s = style.lower()
        try:
            if s in ["arabic", r"\d+"]:
                return int(text)
            elif s == "roman":
                return FormatParser.parse_roman(text)
            elif s == "greek":
                return FormatParser.parse_greek(text)
            elif s in ["alpha", r"[a-z]", r"[a-za-z]+"]:
                return FormatParser.parse_alpha(text)
            elif s == "stephanus" or s == r"\d+[a-e]":
                return FormatParser.parse_stephanus(text)
            return None
        except:
            return None

# ── Hierarchy parsing ─────────────────────────────────────────────────────────

def parse_hierarchy(yaml_str: str) -> List[Level]:
    data = yaml.safe_load(yaml_str)
    levels = []

    def get_regex_for_style(style: str) -> str:
        if style == 'Roman': return r'^(?=[MDCLXVI])M*(C[MD]|D?C*)(X[CL]|L?X*)(I[XV]|V?I*)$'
        if style == 'roman': return r'^(?=[mdclxvi])m*(c[md]|d?c*)(x[cl]|l?x*)(i[xv]|v?i*)$'
        if style == 'Greek': return r'^[͵]?[ΑΒΓΔΕϚΖΗΘΙΚΛΜΝΞΟΠϞΡΣΤΥΦΧΨΩϠ]+[ʹ]?$'
        if style == 'greek': return r'^[͵]?[αβγδεϛζηθικλμνξοπϟρστυφχψωϡ]+[ʹ]?$'
        if style == 'Alpha': return r'^[A-Z]+$'
        if style == 'alpha': return r'^[a-z]+$'
        if style == 'stephanus': return r'^\d+[a-e]$'
        if style == 'Arabic' or style == 'arabic': return r'^\d+$'
        return f"^{style}$"

    def traverse(node, depth):
        if not node:
            return
        style = node.get('format', 'arabic')
        levels.append(Level(
            depth=depth,
            name=node.get('name', f'lvl_{depth}'),
            style=style,
            format_regex=get_regex_for_style(style),
            missing_first=node.get('missing_first', False),
            is_milestone=node.get('is_milestone', False)
        ))
        if 'child' in node:
            traverse(node['child'], depth + 1)

    traverse(data.get('structure', {}), 1)
    return levels

# ── process_and_build_divs ────────────────────────────────────────────────────

def _parse_attr(attrs_str: str, name: str) -> Optional[str]:
    """Extracts an attribute value from a string like ' level="2" type="div"'."""
    m = re.search(rf'{name}="([^"]*)"', attrs_str)
    return m.group(1) if m else None


def process_and_build_divs(md_text: str, level_map: dict, milestone_levels=None) -> str:
    if milestone_levels is None:
        milestone_levels = set()

    lines = md_text.splitlines()
    output = []
    stack = []

    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue

        if stripped.startswith("<pb"):
            output.append(stripped)
            continue

        existing_notes = re.findall(r"<note>(.*?)</note>", stripped, re.DOTALL)

        all_refs = re.findall(r"<ref([^>]*)>(.*?)</ref>", stripped)

        if not all_refs:
            notes_xml = "".join(
                f"<note>{escape(n.strip())}</note>"
                for n in existing_notes if n.strip()
            )
            content = re.sub(r"<tab/>\s*", "", stripped).strip()
            content = re.sub(r"<note>.*?</note>", "", content, flags=re.DOTALL).strip()

            if content or notes_xml:
                output.append(f"<p>{escape(content)}{notes_xml}</p>")

            continue

        def parse_ref(attrs_str, val):
            val = val.strip()
            lvl_str = _parse_attr(attrs_str, "level")
            lvl = int(lvl_str) if lvl_str else None
            return val, lvl

        def emit_inline(attrs_str, val):
            val, lvl = parse_ref(attrs_str, val)
            if not lvl:
                return f"<note>{escape(val)}</note>"
            if lvl in milestone_levels:
                unit = level_map.get(lvl, f"level{lvl}")
                return f'<milestone unit="{unit}" n="{val}"/>'
            return f"<note>{escape(val)}</note>"

        first_attrs, first_val = all_refs[0]
        first_val, ref_level = parse_ref(first_attrs, first_val)

        inline_extras = "".join(emit_inline(a, v) for a, v in all_refs[1:])

        content = re.sub(r"<ref[^>]*>.*?</ref>", "", stripped).strip()
        content = re.sub(r"<note>.*?</note>", "", content, flags=re.DOTALL).strip()
        content = re.sub(r"<tab/>\s*", "", content).strip()

        preserved_notes = "".join(
            f"<note>{escape(n.strip())}</note>"
            for n in existing_notes
            if n.strip()
        )

        if not ref_level:
            output.append(f"<note>{escape(first_val)}</note>")
            if content:
                output.append(f"<p>{escape(content)}{inline_extras}{preserved_notes}</p>")
            elif inline_extras or preserved_notes:
                output.append(f"{inline_extras}{preserved_notes}")
            continue

        if ref_level in milestone_levels:
            unit = level_map.get(ref_level, f"level{ref_level}")
            output.append(f'<milestone unit="{unit}" n="{first_val}"/>')
            if content:
                output.append(f"<p>{escape(content)}{inline_extras}{preserved_notes}</p>")
            elif inline_extras or preserved_notes:
                output.append(f"{inline_extras}{preserved_notes}")
            continue

        while stack and stack[-1] >= ref_level:
            output.append("</div>")
            stack.pop()

        div_type = level_map.get(ref_level, f"level{ref_level}")
        output.append(f'<div type="{div_type}" n="{first_val}">')
        stack.append(ref_level)

        if stripped.startswith("#"):
            head_content = stripped.lstrip("#").strip()
            head_content = re.sub(r"<ref[^>]*>.*?</ref>\s*", "", head_content).strip()
            head_content = re.sub(r"<note>.*?</note>", "", head_content, flags=re.DOTALL).strip()
            if head_content:
                output.append(f"<head>{escape(head_content)}</head>")
            if preserved_notes:
                output.append(preserved_notes)
        else:
            if content or inline_extras or preserved_notes:
                output.append(f"<p>{escape(content)}{inline_extras}{preserved_notes}</p>")

    while stack:
        output.append("</div>")
        stack.pop()

    return "\n".join(output)

# ── TEI structure helpers ─────────────────────────────────────────────────────

def resolve_format(fmt: str) -> str:
    return FORMAT_MAP.get(fmt, fmt)


def build_levels(structure, level=1):
    levels = [{
        "level": level,
        "name": structure["name"],
        "regex": resolve_format(structure["format"]),
        "missing_first": structure.get("missing_first", False),
        "is_milestone": structure.get("is_milestone", False),
    }]
    child = structure.get("child")
    if child:
        levels += build_levels(child, level + 1)
    return levels


def compile_levels(levels):
    for lvl in levels:
        pattern = lvl["regex"]
        if not pattern.startswith("^"):
            pattern = "^" + pattern
        if not pattern.endswith("$"):
            pattern = pattern + "$"
        lvl["compiled"] = re.compile(pattern)
    return levels


def build_level_map(levels):
    return {lvl["level"]: lvl["name"] for lvl in levels}


def build_milestone_set(levels):
    return {lvl["level"] for lvl in levels if lvl.get("is_milestone")}


def build_cite_structure_from_yaml(struct_node, is_root=True):
    name = struct_node["name"]
    is_milestone = struct_node.get("is_milestone", False)

    if is_root:
        match = f"/TEI/text/body/div[@type='{name}']"
    elif is_milestone:
        match = f"milestone[@unit='{name}']"
    else:
        match = f"div[@type='{name}']"

    elem = ET.Element(f"{{{NS}}}citeStructure", match=match, unit=name, use="@n")
    if not is_root:
        elem.set("delim", ".")

    child = struct_node.get("child")
    if child:
        elem.append(build_cite_structure_from_yaml(child, is_root=False))
    return elem


def add_cite_structure_to_header(tei_root, config):
    teiHeader = tei_root.find(f".//{{{NS}}}teiHeader")
    if teiHeader is None:
        teiHeader = ET.SubElement(tei_root, f"{{{NS}}}teiHeader")

    encodingDesc = teiHeader.find(f"{{{NS}}}encodingDesc")
    if encodingDesc is None:
        encodingDesc = ET.SubElement(teiHeader, f"{{{NS}}}encodingDesc")

    old = encodingDesc.find(f"{{{NS}}}refsDecl")
    if old is not None:
        encodingDesc.remove(old)

    refsDecl = ET.Element(f"{{{NS}}}refsDecl")
    refsDecl.append(build_cite_structure_from_yaml(config["structure"], is_root=True))
    encodingDesc.append(refsDecl)

# ── Paragraph continuation ────────────────────────────────────────────────────

def mark_continuations(md_text: str) -> str:
    lines = md_text.splitlines()
    result = list(lines)

    for i, line in enumerate(lines):
        if not line.strip().startswith("<pb"):
            continue

        j = i + 1
        while j < len(lines) and not lines[j].strip():
            j += 1

        if j >= len(lines):
            continue

        next_line = lines[j].strip()

        if next_line.startswith("#"):
            continue
        if next_line.startswith("<tab/>"):
            continue
        if next_line.startswith("<ref>"):
            continue
        result[j] = "__CONTINUATION__" + lines[j]

    return "\n".join(result)


def merge_continuation_paragraphs(tei_root):
    NS_P  = f"{{{NS}}}p"
    NS_PB = f"{{{NS}}}pb"
    MARKER = "__CONTINUATION__"

    for parent in tei_root.iter():
        children = list(parent)

        for i, child in enumerate(children):
            if child.tag != NS_P:
                continue
            if not (child.text and child.text.startswith(MARKER)):
                continue

            child.text = child.text[len(MARKER):]

            pb_elem = None
            pb_idx  = None
            for k in range(i - 1, -1, -1):
                if children[k].tag == NS_PB:
                    pb_elem = children[k]
                    pb_idx  = k
                    break
                if children[k].tail and children[k].tail.strip():
                    break

            prev_p = None
            if pb_elem is not None:
                for k in range(pb_idx - 1, -1, -1):
                    if children[k].tag == NS_P:
                        prev_p = children[k]
                        break
                    if children[k].tail and children[k].tail.strip():
                        break

            if prev_p is None or pb_elem is None:
                continue

            if len(prev_p) == 0:
                prev_p.text = (prev_p.text or "").rstrip() + " "
            else:
                prev_p[-1].tail = (prev_p[-1].tail or "").rstrip() + " "

            parent.remove(pb_elem)
            pb_elem.tail = " " + (child.text or "").strip()
            prev_p.append(pb_elem)

            for subchild in list(child):
                prev_p.append(subchild)

            parent.remove(child)
            children = list(parent)

    return tei_root


def replace_linebreak_hyphenation(tei_root):
    NS_P  = f"{{{NS}}}p"
    NS_LB = f"{{{NS}}}lb"

    for p in tei_root.iter(NS_P):
        children = list(p)

        if children and p.text:
            m = re.search(r"^(.*?)(\w+)-(\s*)$", p.text, re.DOTALL)
            if m:
                prefix = m.group(1)
                word_part = m.group(2)
                trailing_spaces = m.group(3)
                if trailing_spaces or children:
                    p.text = prefix + word_part
                    lb = ET.Element(NS_LB)
                    lb.set("break", "no")
                    lb.tail = ""
                    p.insert(0, lb)

        children = list(p)

        for i in range(len(children) - 1):
            current = children[i]
            tail = current.tail or ""
            m = re.search(r"^(.*?)(\w+)-(\s*)$", tail, re.DOTALL)
            if not m:
                continue
            prefix = m.group(1)
            word_part = m.group(2)
            trailing_spaces = m.group(3)
            if trailing_spaces or i + 1 < len(children):
                current.tail = prefix + word_part
                lb = ET.Element(NS_LB)
                lb.set("break", "no")
                lb.tail = ""
                p.insert(i + 1, lb)
                children = list(p)

    return tei_root

# ── Validation ────────────────────────────────────────────────────────────────

def validate_tei_rng(xml_path: Path, rng_path: Path = DEFAULT_RNG):
    if not _HAS_LXML:
        print("[md2tei] lxml not available — skipping RNG validation")
        return True

    if not rng_path.exists():
        print(f"[md2tei] RNG schema not found at {rng_path} — skipping validation")
        return True

    relaxng = _lxml_etree.RelaxNG(_lxml_etree.parse(str(rng_path)))
    xml_doc = _lxml_etree.parse(str(xml_path))

    if relaxng.validate(xml_doc):
        print("[md2tei] TEI validation: OK")
        return True

    print("[md2tei] TEI validation: FAILED")
    for error in relaxng.error_log:
        print(f"[RNG] line {error.line}: {error.message}")
    raise RuntimeError("TEI validation failed")

# ── run_md2tei ────────────────────────────────────────────────────────────────

def run_md2tei(args):
    input_path = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        raise FileNotFoundError(input_path)

    print(f"[md2tei] Reading {input_path}")

    md_text = input_path.read_text(encoding="utf-8")
    md_text = mark_continuations(md_text)

    with open(args.config) as f:
        config = yaml.safe_load(f)

    levels_def = compile_levels(build_levels(config["structure"]))
    level_map = build_level_map(levels_def)
    milestone_levels = build_milestone_set(levels_def)

    processed = process_and_build_divs(md_text, level_map, milestone_levels=milestone_levels)

    tei_str = f"""<?xml version="1.0" encoding="UTF-8"?>
<TEI xmlns="http://www.tei-c.org/ns/1.0">
  <teiHeader>
    <fileDesc>
      <titleStmt><title>OCR Document</title></titleStmt>
      <publicationStmt><p>Generated by OCR pipeline</p></publicationStmt>
      <sourceDesc><p>Born-digital OCR</p></sourceDesc>
    </fileDesc>
  </teiHeader>
  <text>
    <body>
      <div>
{processed}
      </div>
    </body>
  </text>
</TEI>
"""

    root = ET.fromstring(tei_str)
    root = merge_continuation_paragraphs(root)
    root = replace_linebreak_hyphenation(root)
    add_cite_structure_to_header(root, config)

    ET.indent(ET.ElementTree(root), space="  ")
    tei_final = ET.tostring(root, encoding="unicode")

    output_path.write_text(tei_final, encoding="utf-8")
    print(f"[md2tei] Wrote TEI → {output_path}")

    print("[md2tei] Validating TEI against RNG schema")
    validate_tei_rng(output_path)

    return tei_final

# ── CLI ───────────────────────────────────────────────────────────────────────

def build_parser():
    parser = argparse.ArgumentParser(prog='cllg_export', description='CLLG TEI export tool')
    sub = parser.add_subparsers(dest='command')
    p = sub.add_parser('md2tei', help='Convert Markdown to TEI XML')
    p.add_argument('--input',  required=True, help='Input markdown file')
    p.add_argument('--output', required=True, help='Output TEI XML file')
    p.add_argument('--config', required=True, help='YAML config file')
    return parser


def main():
    args = build_parser().parse_args()
    if args.command == 'md2tei':
        run_md2tei(args)
    else:
        build_parser().print_help()


if __name__ == '__main__':
    main()
