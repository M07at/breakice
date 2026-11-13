import sys
from docx import Document
from docx.shared import Pt
from docx.oxml.ns import qn

path = sys.argv[1]
doc = Document(path)

TITLE = "破冰局——基于微信小程序的多人在线聚会游戏平台"
for p in doc.paragraphs:
    t = p.text.strip()
    if t.startswith("题目"):
        for r in list(p.runs):
            r._element.getparent().remove(r._element)
        run = p.add_run("题目：" + TITLE)
        run.font.name = "Times New Roman"; run.font.size = Pt(12); run.font.bold = True
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    elif t.startswith("组") and "CS2407" in t:
        for r in list(p.runs):
            r._element.getparent().remove(r._element)
        run = p.add_run("组    号：")
        run.font.name = "Times New Roman"; run.font.size = Pt(12); run.font.bold = True
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    elif t.startswith("（章为宋体小4号加粗") or t == "……":
        p._element.getparent().remove(p._element)
    elif "黑体小2号" in t and "目" in t:
        for r in list(p.runs):
            r._element.getparent().remove(r._element)
        run = p.add_run("目    录")
        run.font.name = "Times New Roman"; run.font.size = Pt(18); run.font.bold = True
        run._element.rPr.rFonts.set(qn("w:eastAsia"), "黑体")
        p.alignment = 1
doc.save(path)
print("cover+toc ok")
