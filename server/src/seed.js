// Default catalog: 22 subjects across 7 domains. Teachers can edit all of it in
// the admin app. Keywords drive the fast out-of-scope check; `icon` is a Simple
// Icons slug (https://simpleicons.org) for the subject's technology logo.
const DEFAULT_CATALOG = [
  {
    domain: 'Programming Fundamentals',
    subjects: [
      {
        name: 'Python Programming',
        icon: 'python',
        description: 'Python syntax, control flow, functions, modules, files and OOP in Python.',
        keywords: 'python, pip, def, list comprehension, dictionary, tuple, pandas, django, flask, indentation error, venv, __init__',
      },
      {
        name: 'Java Programming',
        icon: 'openjdk',
        description: 'Java syntax, classes, inheritance, interfaces, collections, exceptions and the JVM.',
        keywords: 'java, jvm, jdk, public static void main, arraylist, hashmap, spring, maven, gradle, nullpointerexception, interface, extends',
      },
      {
        name: 'C Programming',
        icon: 'c',
        description: 'C language fundamentals: types, pointers, memory management, structs and compilation.',
        keywords: 'c language, c programming, pointer, pointers, malloc, free, printf, scanf, struct, gcc, segmentation fault, segfault, header file',
      },
      {
        name: 'Data Structures & Algorithms',
        icon: 'leetcode',
        description: 'Arrays, linked lists, stacks, queues, trees, graphs, sorting, searching and complexity analysis.',
        keywords: 'algorithm, big o, time complexity, linked list, stack, queue, binary tree, binary search, graph, sorting, quicksort, merge sort, recursion, hash table, dynamic programming',
      },
    ],
  },
  {
    domain: 'Web Development',
    subjects: [
      {
        name: 'HTML & CSS',
        icon: 'html5',
        description: 'Page structure with semantic HTML, styling, layout with flexbox/grid and responsive design.',
        keywords: 'html, css, flexbox, grid, selector, div, semantic, responsive, media query, stylesheet, margin, padding',
      },
      {
        name: 'JavaScript & Front-End Frameworks',
        icon: 'javascript',
        description: 'JavaScript language, the DOM, events, async code and front-end frameworks such as React.',
        keywords: 'javascript, js, dom, react, vue, angular, typescript, promise, async, await, event listener, npm, fetch',
      },
      {
        name: 'Server-Side Web Development',
        icon: 'nodedotjs',
        description: 'Building web servers and APIs: HTTP, REST, routing, authentication and server frameworks.',
        keywords: 'backend, server-side, node.js, express, rest api, http request, endpoint, middleware, session, cookie, php, routing',
      },
    ],
  },
  {
    domain: 'Computer Systems',
    subjects: [
      {
        name: 'Computer Architecture',
        icon: 'intel',
        description: 'CPU design, memory hierarchy, instruction sets, binary arithmetic and hardware components.',
        keywords: 'cpu, alu, register, cache, instruction set, assembly, binary, motherboard, ram, pipeline, von neumann, bus',
      },
      {
        name: 'Operating Systems',
        icon: 'linux',
        description: 'Processes, threads, scheduling, memory management, file systems and concurrency.',
        keywords: 'operating system, process, thread, scheduling, deadlock, kernel, virtual memory, paging, semaphore, mutex, file system',
      },
      {
        name: 'Linux System Administration',
        icon: 'redhat',
        description: 'Linux command line, users and permissions, services, packages, shell scripting.',
        keywords: 'linux, bash, shell script, chmod, sudo, systemd, apt, yum, ubuntu, cron, grep, terminal command',
      },
    ],
  },
  {
    domain: 'Networking & Cloud',
    subjects: [
      {
        name: 'Computer Networks',
        icon: 'wireshark',
        description: 'OSI and TCP/IP models, addressing, protocols and how data moves across networks.',
        keywords: 'network, osi model, tcp, udp, ip address, subnet, subnetting, dns, dhcp, protocol, packet, ethernet, router',
      },
      {
        name: 'Network Administration',
        icon: 'cisco',
        description: 'Configuring and maintaining networks: switches, routers, VLANs, monitoring and troubleshooting.',
        keywords: 'vlan, switch configuration, cisco, routing table, ospf, firewall rule, network monitoring, ping, traceroute, nat, vpn',
      },
      {
        name: 'Cloud Computing',
        icon: 'googlecloud',
        description: 'Cloud service models, virtualization, containers and major cloud platforms.',
        keywords: 'cloud, aws, azure, gcp, iaas, paas, saas, virtual machine, docker, kubernetes, container, serverless, s3',
      },
    ],
  },
  {
    domain: 'Data Management',
    subjects: [
      {
        name: 'Databases & SQL',
        icon: 'mysql',
        description: 'Relational modeling, normalization, SQL queries, transactions and database design.',
        keywords: 'sql, database, query, select, join, primary key, foreign key, normalization, mysql, postgresql, table, transaction',
      },
      {
        name: 'Data Analysis',
        icon: 'pandas',
        description: 'Cleaning, exploring and visualizing data, and drawing conclusions from it.',
        keywords: 'data analysis, dataset, visualization, chart, spreadsheet, excel, pivot table, data cleaning, dashboard, matplotlib',
      },
      {
        name: 'Big Data Technologies',
        icon: 'apachespark',
        description: 'Distributed storage and processing of large datasets: Hadoop, Spark and NoSQL.',
        keywords: 'big data, hadoop, spark, mapreduce, hdfs, nosql, mongodb, kafka, data lake, distributed processing',
      },
    ],
  },
  {
    domain: 'Cybersecurity',
    subjects: [
      {
        name: 'Information Security Fundamentals',
        icon: 'owasp',
        description: 'Security principles, threats, cryptography basics, authentication and security policy.',
        keywords: 'security, cia triad, encryption, cryptography, hashing, authentication, malware, phishing, password policy, risk',
      },
      {
        name: 'Ethical Hacking',
        icon: 'kalilinux',
        description: 'Authorized penetration testing methodology, vulnerability assessment and defensive lessons.',
        keywords: 'penetration testing, pentest, vulnerability, exploit, nmap, metasploit, sql injection, xss, ctf, burp suite',
      },
      {
        name: 'Digital Forensics',
        icon: 'virustotal',
        description: 'Evidence acquisition, chain of custody, file system and memory analysis, incident response.',
        keywords: 'forensics, evidence, chain of custody, disk image, incident response, log analysis, autopsy, memory dump',
      },
    ],
  },
  {
    domain: 'Mathematics & AI',
    subjects: [
      {
        name: 'Discrete Mathematics',
        icon: 'wolframmathematica',
        description: 'Logic, sets, functions, relations, combinatorics, proofs and graph theory for computing.',
        keywords: 'discrete math, logic, truth table, set theory, proof, induction, combinatorics, permutation, boolean algebra, relation',
      },
      {
        name: 'Statistics & Probability',
        icon: 'r',
        description: 'Descriptive statistics, probability, distributions, hypothesis testing and regression.',
        keywords: 'statistics, probability, mean, median, standard deviation, variance, distribution, hypothesis test, p-value, regression',
      },
      {
        name: 'Machine Learning',
        icon: 'tensorflow',
        description: 'Supervised and unsupervised learning, model training, evaluation and neural networks.',
        keywords: 'machine learning, neural network, training data, overfitting, classification, clustering, scikit-learn, deep learning, gradient descent, model accuracy',
      },
    ],
  },
];

const DEFAULT_GOALS = [
  'Develop independent problem-solving skills: students should be able to break a problem into steps and attempt each step themselves.',
  'Build a solid understanding of core concepts rather than memorizing answers.',
  'Practice professional, ethical and legal use of information technology.',
];

module.exports = { DEFAULT_CATALOG, DEFAULT_GOALS };
