var p = Ent.Project.create('boss', 'js');
p.setVersion(1, 1, 0);
p.setBolt('library', '**/*.js');
p.setBoltTest();

