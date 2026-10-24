import csv

# Curated verb-phrase for each unique Role, to fit "you do {{ do }} at {{ school }}".
DO_MAP = {
    "A.P. Computer Science": "teach AP computer science",
    "AP COMPUTER SCIENCE": "teach AP computer science",
    "AP Computer Science": "teach AP computer science",
    "AP Computer Science A": "teach AP computer science A",
    "AP Computer Science Principles": "teach AP computer science principles",
    "AP Computer Science Principles Teacher": "teach AP computer science principles",
    "Adviser - Computer Club": "advise the computer club",
    "Algebra & Computer Science": "teach algebra and computer science",
    "Algebra and AP Computer Science": "teach algebra and AP computer science",
    "COMPUTER SCIENCE": "teach computer science",
    "CTE Content Computer Science Trade and Technical": "teach CTE computer science trade and technical content",
    "CTE Teacher, AP Computer Science": "teach AP computer science",
    "CTE Teacher, Cyber Security": "teach cybersecurity",
    "CTE Teacher, Game Design & Development": "teach game design and development",
    "CTE- Computer Science": "teach CTE computer science",
    "CTE-Computer Science": "teach CTE computer science",
    "CTE:CIS and Computer Science": "teach CIS and computer science",
    "Cisco Systems/Cybersecurity Teacher": "teach Cisco systems and cybersecurity",
    "Coding Café Club": "run the coding café club",
    "Coding/Robotics Club": "run the coding/robotics club",
    "Computer Club Advisor": "advise the computer club",
    "Computer Networking & Cybersecurity Instructor": "instruct computer networking and cybersecurity",
    "Computer Science": "teach computer science",
    "Computer Science & Information Technology Department Chair": "chair the computer science and information technology department",
    "Computer Science & Math Teacher": "teach computer science and math",
    "Computer Science & Physics": "teach computer science and physics",
    "Computer Science & Technology": "teach computer science and technology",
    "Computer Science Club Advisor": "advise the computer science club",
    "Computer Science Coordinator": "coordinate computer science",
    "Computer Science Essentials - Computer Science Principles - Intro to Software Development - Web Design": "teach computer science essentials, computer science principles, intro to software development, and web design",
    "Computer Science Honor Society Advisor": "advise the computer science honor society",
    "Computer Science Instructor": "instruct computer science",
    "Computer Science Lead": "lead computer science",
    "Computer Science Teacher": "teach computer science",
    "Computer Science Teacher/School Programmer": "teach computer science",
    "Computer Science and Cybersecurity": "teach computer science and cybersecurity",
    "Computer Science and Digital Literacy": "teach computer science and digital literacy",
    "Computer Science courses": "teach computer science courses",
    "Computer Science/ STEM": "teach computer science and STEM",
    "Computer Science/CTE Faculty": "teach computer science and CTE",
    "Computer Science/Intro to Business": "teach computer science and intro to business",
    "Computer Science/STEM": "teach computer science and STEM",
    "Cyber Security & Technology Contract Consortium Coordinator": "coordinate cybersecurity and technology contracts",
    "Department Chairperson-Computer Science/CTE": "chair the computer science and CTE department",
    "Elementary Computer Science Technology Teacher Leader": "lead elementary computer science and technology teaching",
    "Engineering/Computer Science Teacher": "teach engineering and computer science",
    "Essentials of Computer Science": "teach essentials of computer science",
    "Essentials of Computer Science, AP Computer Science(Principles and A), and Video Game Design": "teach essentials of computer science, AP computer science, and video game design",
    "Geometry/ Trigonometry/ Computer Science": "teach geometry, trigonometry, and computer science",
    "H/S Math/Computer Science": "teach math and computer science",
    "High School Computer Science & Math Teacher": "teach high school computer science and math",
    "High School Science Computer Science": "teach high school science and computer science",
    "HighSchool Computer Science & Math Teacher": "teach high school computer science and math",
    "Instructor: Computer Networking & Cybersecurity": "instruct computer networking and cybersecurity",
    "MATHEMATICS, AP COMPUTER SCIENCE, & ROBOTICS": "teach mathematics, AP computer science, and robotics",
    "Math/AP Computer Science": "teach math and AP computer science",
    "Math/Computer Science": "teach math and computer science",
    "Mathematics & Computer Science": "teach mathematics and computer science",
    "Mathematics / Computer Science Director": "direct mathematics and computer science",
    "Mathematics/Computer Science": "teach mathematics and computer science",
    "Mathematics/Computer Science Teacher": "teach mathematics and computer science",
    "Musical Theater/ Computer Science": "teach musical theater and computer science",
    "PTECH Computer Science": "teach PTECH computer science",
    "Robotics": "teach robotics",
    "Robotics Advisor": "advise the robotics program",
    "Robotics Club Advisor": "advise the robotics club",
    "Robotics Engineering": "teach robotics engineering",
    "Robotics teacher": "teach robotics",
    "Supervisor of Computer Science": "supervise computer science",
    "Supervisor of Math, Science & Computer Science - Secondary": "supervise math, science, and computer science",
    "Teacher (Computer Science)": "teach computer science",
    "Teacher Computer Science/Technology": "teach computer science and technology",
    "computer science teacher": "teach computer science",
}

IN_PATH = "inc.csv"
OUT_PATH = "inc_enriched.csv"

with open(IN_PATH, newline="", encoding="utf-8") as f:
    reader = csv.reader(f)
    header = next(reader)
    rows = [r for r in reader]

missing = sorted({r[1] for r in rows if r[1] not in DO_MAP})
if missing:
    raise SystemExit("Missing DO_MAP entries for: %r" % missing)

out_header = ["Name", "Role", "Do", "Location", "School", "Email", "Evidence"]

with open(OUT_PATH, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(out_header)
    for r in rows:
        name, role, location, email, evidence = r
        school = ",".join(location.split(",")[:-1])
        do = DO_MAP[role]
        w.writerow([name, role, do, location, school, email, evidence])

print("Wrote", OUT_PATH, "with", len(rows), "rows")
