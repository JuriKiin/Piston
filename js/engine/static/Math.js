export default {
    degreesToRadians(degrees) {
        return degrees * (Math.PI / 180);
    },

    cos(degrees) {
        return Math.cos(this.degreesToRadians(degrees));
    },
    
    sin(degrees) {
        return Math.sin(this.degreesToRadians(degrees));
    }
}