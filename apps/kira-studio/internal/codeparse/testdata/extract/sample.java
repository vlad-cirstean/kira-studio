interface Greeter {
    String greet(String name);
}

class Person implements Greeter {
    public String greet(String name) {
        return helper(name);
    }

    private String helper(String name) {
        return "hi " + name;
    }
}

class Robot extends Person {
    void build() {
        Person p = new Person();
    }
}
